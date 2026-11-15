import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { Envelope } from "@terrasight/shared";
import { ENV, runsWorker, type Env } from "../config/config.js";
import { BROKER, type Broker } from "../messaging/broker.js";
import { JobConsumer } from "../messaging/consumer.js";
import { QUEUES } from "../messaging/topology.js";
import { ZonesService, type BuildJob } from "./zones.service.js";

const RETRIES = 1;

/** Runs `zones.build` jobs (one at a time: each reads hundreds of Sentinel-2 windows). */
@Injectable()
export class ZonesConsumer extends JobConsumer<BuildJob> implements OnModuleInit {
  constructor(
    @Inject(BROKER) broker: Broker,
    @Inject(ENV) private readonly env: Env,
    private readonly zones: ZonesService,
  ) {
    super(broker, { queue: QUEUES.zonesBuild, prefetch: 1, retries: RETRIES });
  }

  async onModuleInit(): Promise<void> {
    if (runsWorker(this.env)) await this.start();
  }

  async handle(env: Envelope<BuildJob>, attempt: number): Promise<void> {
    await this.zones.run(env.data, attempt, RETRIES);
  }
}
