import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ENV, runsApi, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { BROKER, type Broker } from "./broker.js";
import type { OutboxRow } from "./outbox.js";
import { relayOnce, type OutboxStore, type PendingRow } from "./outbox-relay.js";

const TICK_MS = 500;

type Tx = Pick<Prisma.TransactionClient, "outbox">;

/**
 * Transactional outbox (Tech Design §7): `add` writes rows inside the caller's transaction; the relay
 * (in api/all roles) publishes them and marks them published.
 */
@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy, OutboxStore {
  private readonly log = new Logger(OutboxService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BROKER) private readonly broker: Broker,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Insert outbox rows in the caller's transaction. */
  async add(tx: Tx, rows: OutboxRow[]): Promise<void> {
    if (!rows.length) return;
    await tx.outbox.createMany({
      data: rows.map((r) => ({
        exchange: r.exchange,
        routingKey: r.routingKey,
        payload: r.payload as unknown as Prisma.InputJsonValue,
        headers: (r.headers ?? undefined) as Prisma.InputJsonValue | undefined,
      })),
    });
  }

  onModuleInit(): void {
    if (!runsApi(this.env)) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running || !this.broker.connected) return;
    this.running = true;
    try {
      await relayOnce(this, this.broker);
    } catch (e) {
      this.log.warn(`Outbox relay failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async withPending(limit: number, fn: (rows: PendingRow[]) => Promise<bigint[]>): Promise<number> {
    return this.prisma.system.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: bigint;
          exchange: string;
          routing_key: string;
          payload: PendingRow["payload"];
          headers: PendingRow["headers"];
        }>
      >`SELECT id, exchange, routing_key, payload, headers FROM outbox
        WHERE published_at IS NULL ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
      if (!rows.length) return 0;
      const done = await fn(
        rows.map((r) => ({
          id: r.id,
          exchange: r.exchange,
          routingKey: r.routing_key,
          payload: r.payload,
          headers: r.headers,
        })),
      );
      if (done.length) {
        await tx.outbox.updateMany({ where: { id: { in: done } }, data: { publishedAt: new Date() } });
      }
      return done.length;
    });
  }
}
