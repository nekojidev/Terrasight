import { Controller, Get, HttpCode, HttpException, HttpStatus, Inject } from "@nestjs/common";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import { BROKER, type Broker } from "../messaging/broker.js";
import { RedisService } from "../redis/redis.service.js";

/** `/healthz` = the process is up; `/readyz` = PostgreSQL and RabbitMQ reachable; Redis is optional (Tech Design §17). */
@Controller()
export class HealthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    @Inject(BROKER) private readonly broker: Broker,
    private readonly redis: RedisService,
  ) {}

  @Get("healthz")
  healthz() {
    return { status: "ok", role: this.env.ROLE };
  }

  @Get("readyz")
  @HttpCode(200)
  async readyz() {
    const checks = {
      postgres: await this.prisma.ping(),
      rabbitmq: this.broker.connected,
      redis: this.redis.client === null ? "not configured" : this.redis.available ? "up" : "down (fallback)",
    };
    const ready = checks.postgres && checks.rabbitmq;
    if (!ready) throw new HttpException({ status: "not ready", checks }, HttpStatus.SERVICE_UNAVAILABLE);
    return { status: "ready", checks };
  }
}
