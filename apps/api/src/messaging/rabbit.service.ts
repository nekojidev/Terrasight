import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import amqp, { type Channel, type ChannelModel, type ConfirmChannel } from "amqplib";
import { ENV, type Env } from "../config/config.js";
import type { Broker, ConsumeHandler, IncomingMessage, PublishOptions } from "./broker.js";
import { processDelivery } from "./delivery.js";
import { declareTopology } from "./topology.js";

const RECONNECT_MS = 2_000;

/**
 * amqplib implementation of Broker with reconnects. Consumers and subscriptions are re-registered after a
 * reconnect. Publishing while disconnected rejects; callers that must not lose work go through the outbox.
 */
@Injectable()
export class RabbitService implements Broker, OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RabbitService.name);
  private conn: ChannelModel | null = null;
  private ch: ConfirmChannel | null = null;
  private closing = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly consumers: Array<() => Promise<void>> = [];

  constructor(@Inject(ENV) private readonly env: Env) {}

  get connected(): boolean {
    return this.ch !== null;
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    await this.conn?.close().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    try {
      const conn = await amqp.connect(this.env.RABBITMQ_URL);
      const ch = await conn.createConfirmChannel();
      await declareTopology(ch);
      conn.on("close", () => this.onLost(conn, "closed"));
      conn.on("error", (e: Error) => this.log.warn(`RabbitMQ error: ${e.message}`));
      // A channel can die on its own (e.g. a protocol error) while the connection stays up: without these
      // handlers amqplib emits an unhandled `error` event and every later ack/publish throws.
      ch.on("error", (e: Error) => this.log.warn(`RabbitMQ channel error: ${e.message}`));
      ch.on("close", () => {
        if (this.conn !== conn) return;
        this.onLost(conn, "channel closed");
        conn.close().catch(() => undefined);
      });
      this.conn = conn;
      this.ch = ch;
      this.log.log("RabbitMQ connected, topology declared");
      for (const register of this.consumers) await register();
    } catch (e) {
      this.log.warn(`RabbitMQ unavailable (${(e as Error).message}); retrying in ${RECONNECT_MS} ms`);
      this.scheduleReconnect();
    }
  }

  private onLost(from: ChannelModel, reason: string): void {
    if (this.conn !== from) return; // an old connection closing after we already moved on
    this.conn = null;
    this.ch = null;
    if (this.closing) return;
    this.log.warn(`RabbitMQ connection ${reason}; reconnecting`);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closing) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, RECONNECT_MS);
    this.reconnectTimer.unref();
  }

  async publish(exchange: string, routingKey: string, body: unknown, options: PublishOptions): Promise<void> {
    const ch = this.ch;
    if (!ch) throw new Error("RabbitMQ not connected");
    const content = Buffer.from(JSON.stringify(body));
    await new Promise<void>((resolve, reject) => {
      ch.publish(
        exchange,
        routingKey,
        content,
        {
          messageId: options.messageId,
          headers: options.headers ?? {},
          persistent: options.persistent ?? true,
          contentType: "application/json",
        },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }

  async consume(queue: string, prefetch: number, handler: ConsumeHandler): Promise<void> {
    const register = async () => {
      const ch = this.ch;
      if (!ch) return;
      await ch.prefetch(prefetch);
      await ch.consume(queue, (raw) => {
        if (!raw) return;
        void processDelivery(
          ch,
          raw,
          queue,
          handler,
          (exchange, key, body, options) => this.publish(exchange, key, body, options),
          this.log,
        ).catch((e: unknown) => this.log.error(`delivery on ${queue} failed: ${(e as Error).message}`));
      });
    };
    this.consumers.push(register);
    await register();
  }

  /** Messages waiting in a queue, or null while disconnected. Uses a throwaway channel: a failed passive declare closes its channel. */
  async queueDepth(queue: string): Promise<number | null> {
    const conn = this.conn;
    if (!conn) return null;
    let ch: Channel | null = null;
    try {
      ch = await conn.createChannel();
      ch.on("error", () => undefined);
      return (await ch.checkQueue(queue)).messageCount;
    } catch {
      return null;
    } finally {
      await ch?.close().catch(() => undefined);
    }
  }

  async subscribe(exchange: string, pattern: string, handler: (msg: IncomingMessage) => void): Promise<void> {
    const register = async () => {
      const ch = this.ch;
      if (!ch) return;
      const { queue } = await ch.assertQueue("", { exclusive: true, autoDelete: true });
      await ch.bindQueue(queue, exchange, pattern);
      await ch.consume(
        queue,
        (raw) => {
          if (!raw) return;
          try {
            handler({
              content: raw.content,
              routingKey: raw.fields.routingKey,
              headers: (raw.properties.headers ?? {}) as Record<string, unknown>,
            });
          } catch (e) {
            this.log.warn(`subscriber on ${exchange} threw: ${(e as Error).message}`);
          }
        },
        { noAck: true },
      );
    };
    this.consumers.push(register);
    await register();
  }
}
