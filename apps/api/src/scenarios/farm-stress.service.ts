import { Inject, Injectable } from "@nestjs/common";
import type { EngineResult } from "@terrasight/scenario-engine";
import type { FarmStress } from "@terrasight/shared";
import { ENV, type Env } from "../config/config.js";
import { CropPricesService } from "../crop-prices/crop-prices.service.js";
import { PrismaService } from "../db/prisma.service.js";
import { farmStress, type StressFieldOutcome } from "./farm-stress.js";
import { ScenariosService } from "./scenarios.service.js";

/** At most this many missing runs are computed inside one request (and only while the worker pool is idle). */
const MAX_INLINE_RUNS = 3;
/** A repeated read within this time skips the per-field input check. */
const FRESH_MS = 30_000;

/** Farm stress test (S-10.13): stored default rotation runs of every active field, summed. No new model. */
@Injectable()
export class FarmStressService {
  private readonly cache = new Map<string, { key: string; at: number; value: FarmStress }>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly scenarios: ScenariosService,
    private readonly cropPrices: CropPricesService,
  ) {}

  async get(workspaceId: string): Promise<FarmStress> {
    const memo = this.cache.get(workspaceId);
    if (memo && Date.now() - memo.at < FRESH_MS) return memo.value;
    const [fields, currency] = await Promise.all([
      this.prisma.db.field.findMany({
        where: { workspaceId, archivedAt: null },
        select: { id: true, name: true, areaHa: true },
        orderBy: { name: "asc" },
      }),
      this.cropPrices.currency(workspaceId),
    ]);
    let inline = 0;
    const rows: Array<{ fieldId: string; name: string; areaHa: number; outcome: StressFieldOutcome }> = [];
    const parts: string[] = [];
    let season = this.env.PLAN_FIRST_SEASON;
    for (const f of fields) {
      const outcome = await this.outcome(workspaceId, f.id, () => inline++ < MAX_INLINE_RUNS, (s) => (season = s));
      rows.push({ fieldId: f.id, name: f.name, areaHa: f.areaHa, outcome });
      parts.push(`${f.id}:${f.areaHa}:${outcome.kind === "run" ? (outcome.runId ?? "run") : outcome.reason}`);
    }
    // The answer holds until a field's run (or its absence) changes.
    const key = `${currency}|${season}|${parts.join(",")}`;
    if (memo && memo.key === key) {
      memo.at = Date.now();
      return memo.value;
    }
    const value = farmStress(rows, currency, season);
    this.cache.set(workspaceId, { key, at: Date.now(), value });
    return value;
  }

  private async outcome(
    workspaceId: string,
    fieldId: string,
    mayCompute: () => boolean,
    setSeason: (s: number) => void,
  ): Promise<StressFieldOutcome> {
    let prep;
    try {
      // Stored proposals only: the assistant is never called from this read.
      prep = await this.scenarios.prepare(workspaceId, fieldId, {}, "cached");
    } catch {
      return { kind: "skip", reason: "no-run" };
    }
    if (prep.early) {
      const e = prep.early as { landUnsuitable?: boolean };
      return { kind: "skip", reason: e.landUnsuitable ? "land-unsuitable" : "no-run" };
    }
    if (prep.input.agronomyOnly) return { kind: "skip", reason: "no-prices" };
    setSeason(prep.input.firstSeason);
    let run: { id: string; result: EngineResult } | null = await this.scenarios.cachedRun(fieldId, prep.input);
    if (!run && this.scenarios.poolIdle() && mayCompute()) {
      try {
        run = await this.scenarios.execute(fieldId, prep.input);
      } catch {
        run = null;
      }
    }
    if (!run) return { kind: "skip", reason: "no-run" };
    return { kind: "run", result: run.result, currency: prep.meta.currency, runId: run.id };
  }
}
