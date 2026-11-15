import { EQUAL_WEIGHTS, rank, type EngineResult } from "@terrasight/scenario-engine";
import type { YearSetId, YearSetOption, YearSetRanking, YearSetShift } from "@terrasight/shared";

/**
 * One year set's ranking from an engine result of fixed candidates: every option of the result, ranked with equal
 * priorities inside the set (the engine's `rank`, same function the page uses). Pure.
 */
export function rankingOfSet(id: YearSetId, result: EngineResult, shift: YearSetShift | null): YearSetRanking {
  const scored = rank([result.current, ...result.alternatives], EQUAL_WEIGHTS)
    .map((s, i) => ({ s, i }))
    // Highest score first; a tie keeps the engine's order (current plan first), so ranking never depends on sort luck.
    .sort((a, b) => (b.s.score ?? 0) - (a.s.score ?? 0) || a.i - b.i)
    .map(({ s }) => s);
  const options: YearSetOption[] = scored.map((s, i) => ({
    id: s.id,
    rank: i + 1,
    margin: s.margin,
    drought: s.drought ?? s.droughtYield,
    score: s.score ?? 0,
  }));
  return {
    id,
    years: { from: result.weather.from, to: result.weather.to, count: result.weather.count },
    shift,
    options,
    best: options[0]!.id,
  };
}

/** True when the rank-1 option is not the same in every set. */
export function bestChanges(sets: YearSetRanking[]): boolean {
  return new Set(sets.map((s) => s.best)).size > 1;
}
