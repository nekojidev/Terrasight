import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ENV, runsScheduler, type Env } from "../config/config.js";
import { AnalysisService } from "./analysis.service.js";

const TICK_MS = 2 * 60_000;

/** Periodically fails field checks whose worker died and finishes their runs (see AnalysisService.reapStale). */
@Injectable()
export class StaleCheckReaper implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(StaleCheckReaper.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly analysis: AnalysisService,
  ) {}

  onModuleInit(): void {
    if (!runsScheduler(this.env) || this.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<number> {
    try {
      return await this.analysis.reapStale();
    } catch (e) {
      this.log.error(`stale check reaper failed: ${(e as Error).message}`);
      return 0;
    }
  }
}
