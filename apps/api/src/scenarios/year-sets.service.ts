import { Injectable } from "@nestjs/common";
import { dailyFromPower, trendShift } from "@terrasight/climate";
import { MIN_SET_YEARS, YearSetTooSmallError, yearsOfSet, type EngineInput } from "@terrasight/scenario-engine";
import {
  YEAR_SET_IDS,
  type YearSetComparison,
  type YearSetId,
  type YearSetRanking,
  type YearSetShift,
} from "@terrasight/shared";
import { ProblemException } from "../http/problem.js";
import type { Overrides } from "./scenario-inputs.service.js";
import { ScenariosService } from "./scenarios.service.js";
import { bestChanges, rankingOfSet } from "./year-sets.js";

/** Season the trend is carried to: the middle of the plan 2026–2030 (T8). */
const TREND_TARGET_YEAR = 2028;
const TREND_ALPHA = 0.05;

/** Sensitivity of the ranking to the weather years (S-10.06). Never a forecast; the recommendation stays on all years. */
@Injectable()
export class YearSetsService {
  constructor(private readonly scenarios: ScenariosService) {}

  async compare(workspaceId: string, fieldId: string, o: Overrides): Promise<YearSetComparison> {
    // The assistant is never called again here: only proposals already stored for the field take part.
    const prep = await this.scenarios.prepare(workspaceId, fieldId, o, "cached");
    if (prep.early) {
      const e = prep.early as { landUnsuitable?: boolean };
      throw new ProblemException(
        409,
        e.landUnsuitable ? "land-unsuitable" : "no-rotation-run",
        "There is no rotation comparison for this field yet",
      );
    }
    const { input, meta, power } = prep;
    // The options shown in the default run on all years: these exact ids are evaluated in every set.
    const base = await this.scenarios.execute(fieldId, input);
    const shown = new Set(base.result.alternatives.map((a) => a.id));
    const fixed: EngineInput = {
      ...input,
      rotations: input.rotations.filter((r) => shown.has(r.id)),
      fixedCandidates: true,
    };
    const shift: YearSetShift = trendShift(dailyFromPower(power), input.site.latDeg, {
      targetYear: TREND_TARGET_YEAR,
      alpha: TREND_ALPHA,
    });
    const complete = [...input.weatherByYear.entries()].filter(([, d]) => d.length >= 360).map(([y]) => y);

    const sets = await Promise.all(
      YEAR_SET_IDS.map(async (id): Promise<YearSetRanking | null> => {
        if (id !== "all" && yearsOfSet(complete, id).length < MIN_SET_YEARS) return null;
        const yearSet: EngineInput["yearSet"] =
          id === "trend-2030"
            ? { id, shift: { deltaT: shift.deltaT, precipFactor: shift.precipFactor } }
            : { id };
        try {
          const run = await this.scenarios.execute(fieldId, { ...fixed, yearSet });
          return rankingOfSet(id, run.result, id === "trend-2030" ? shift : null);
        } catch (e) {
          if (e instanceof YearSetTooSmallError) return null;
          throw e;
        }
      }),
    );
    const present = sets.filter((s): s is YearSetRanking => s !== null);
    const ids = new Set(present.flatMap((s) => s.options.map((x) => x.id)));
    const names = this.scenarios.namesOf(input, prep.ai.proposals);
    return {
      mode: base.result.mode,
      currency: base.result.mode === "money" ? meta.currency : null,
      sets: present,
      bestChanges: bestChanges(present),
      names: Object.fromEntries(Object.entries(names).filter(([id]) => ids.has(id))),
    };
  }
}

export type { YearSetId };
