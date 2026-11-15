import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import { RedisService } from "../redis/redis.service.js";

/** Thrown instead of a Gemini call when the day's budget is spent; callers fall back to the template text. */
export class AiBudgetExceeded extends Error {
  constructor(what: string) {
    super(`daily Gemini ${what} budget spent`);
    this.name = "AiBudgetExceeded";
  }
}

export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * Daily Gemini budget (GEMINI_DAILY_TOKEN_BUDGET tokens, GEMINI_DAILY_CALL_BUDGET calls; 0 = unlimited), shared by all
 * instances: counted in Redis when it is up, otherwise in the `ai_usage` table. The check happens before a call
 * (a call is counted when it starts, tokens when it ends), so the last call of the day may overshoot the token budget.
 * Over budget: no calls, template text, one log line per day.
 */
@Injectable()
export class AiBudgetService {
  private readonly log = new Logger(AiBudgetService.name);
  private loggedDay: string | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  get limited(): boolean {
    return this.env.GEMINI_DAILY_TOKEN_BUDGET > 0 || this.env.GEMINI_DAILY_CALL_BUDGET > 0;
  }

  /** Counts a call and throws AiBudgetExceeded when the budget is already spent. */
  async reserve(now = new Date()): Promise<void> {
    if (!this.limited) return;
    const day = utcDay(now);
    const { tokens, calls } = await this.add(day, 0, 1);
    const maxT = this.env.GEMINI_DAILY_TOKEN_BUDGET;
    const maxC = this.env.GEMINI_DAILY_CALL_BUDGET;
    // `calls` already includes this call.
    const what = maxT > 0 && tokens >= maxT ? "token" : maxC > 0 && calls > maxC ? "call" : null;
    if (!what) return;
    if (this.loggedDay !== day) {
      this.loggedDay = day;
      this.log.warn(
        `Gemini daily budget spent (${tokens} tokens, ${calls - 1} calls; limits ${maxT || "none"} / ${maxC || "none"}): using template texts until 00:00 UTC`,
      );
    }
    throw new AiBudgetExceeded(what);
  }

  /** Adds the tokens a finished call used. */
  async record(tokens: number, now = new Date()): Promise<void> {
    if (!this.limited || !(tokens > 0)) return;
    await this.add(utcDay(now), tokens, 0);
  }

  async usage(now = new Date()): Promise<{ tokens: number; calls: number }> {
    return this.add(utcDay(now), 0, 0);
  }

  private async add(day: string, tokens: number, calls: number): Promise<{ tokens: number; calls: number }> {
    if (this.redis?.available) {
      try {
        const kt = `gemini:budget:${day}:tokens`;
        const kc = `gemini:budget:${day}:calls`;
        const c = this.redis.client!;
        const [t, n] = await Promise.all([c.incrby(kt, tokens), c.incrby(kc, calls)]);
        if (tokens || calls) await Promise.all([c.expire(kt, 172_800), c.expire(kc, 172_800)]);
        return { tokens: t, calls: n };
      } catch {
        // Redis went away between the check and the call: the table takes over.
      }
    }
    const rows = await this.prisma.system.$queryRaw<Array<{ tokens: bigint; calls: number }>>`
      INSERT INTO ai_usage (day, tokens, calls) VALUES (${day}::date, ${tokens}, ${calls})
      ON CONFLICT (day) DO UPDATE SET tokens = ai_usage.tokens + ${tokens}, calls = ai_usage.calls + ${calls}
      RETURNING tokens, calls`;
    return { tokens: Number(rows[0]?.tokens ?? 0), calls: rows[0]?.calls ?? 0 };
  }
}
