import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import amqp, { type ChannelModel, type ConfirmChannel } from "amqplib";
import { ENV, type Env } from "../config/config.js";
import type { Broker, ConsumeHandler, IncomingMessage, PublishOptions } from "./broker.js";
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
    await this.conn?.close().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    try {
      const conn = await amqp.connect(this.env.RABBITMQ_URL);
      const ch = await conn.createConfirmChannel();
      await declareTopology(ch);
      conn.on("close", () => this.onLost("closed"));
      conn.on("error", (e: Error) => this.log.warn(`RabbitMQ error: ${e.message}`));
      this.conn = conn;
      this.ch = ch;
      this.log.log("RabbitMQ connected, topology declared");
      for (const register of this.consumers) await register();
    } catch (e) {
      this.log.warn(`RabbitMQ unavailable (${(e as Error).message}); retrying in ${RECONNECT_MS} ms`);
      this.scheduleReconnect();
    }
  }

  private onLost(reason: string): void {
    this.conn = null;
    this.ch = null;
    if (this.closing) return;
    this.log.warn(`RabbitMQ connection ${reason}; reconnecting`);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closing) return;
    setTimeout(() => void this.connect(), RECONNECT_MS).unref();
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
        const msg: IncomingMessage = {
          content: raw.content,
          routingKey: raw.fields.routingKey,
          headers: (raw.properties.headers ?? {}) as Record<string, unknown>,
        };
        handler(msg)
          .then((result) => (result === "ack" ? ch.ack(raw) : ch.nack(raw, false, false)))
          .catch(() => ch.nack(raw, false, false));
      });
    };
    this.consumers.push(register);
    await register();
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
          handler({
            content: raw.content,
            routingKey: raw.fields.routingKey,
            headers: (raw.properties.headers ?? {}) as Record<string, unknown>,
          });
        },
        { noAck: true },
      );
    };
    this.consumers.push(register);
    await register();
  }
}
