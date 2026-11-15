import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { Envelope } from "@terrasight/shared";
import { ENV, runsWorker, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import { BROKER, type Broker } from "../messaging/broker.js";
import { JobConsumer } from "../messaging/consumer.js";
import { jobRow } from "../messaging/outbox.js";
import { OutboxService } from "../messaging/outbox.service.js";
import { QUEUES } from "../messaging/topology.js";
import { RecommendationsService, type CommitJob } from "./recommendations.service.js";

/** Commits an accept (final) or an ask-owner (creates the Decision) when its 8 s Undo window has closed (RFC §10.4). */
@Injectable()
export class CommitConsumer extends JobConsumer<CommitJob & { note?: string }> implements OnModuleInit {
  constructor(
    @Inject(BROKER) broker: Broker,
    @Inject(ENV) private readonly env: Env,
    private readonly recs: RecommendationsService,
    private readonly outbox: OutboxService,
    private readonly prisma: PrismaService,
  ) {
    super(broker, { queue: QUEUES.recommendationCommit, prefetch: 8, retries: 2 });
  }

  async onModuleInit(): Promise<void> {
    if (runsWorker(this.env)) await this.start();
  }

  async handle(env: Envelope<CommitJob & { note?: string }>): Promise<void> {
    const r = await this.recs.commit(env.data);
    // Delivered before the window closed (clock skew between hosts): try again after another delay.
    if (r === "early")
      await this.outbox.add(this.prisma.system, [
        jobRow(QUEUES.recommendationCommit, env.workspaceId, env.data, "8s"),
      ]);
  }
}
