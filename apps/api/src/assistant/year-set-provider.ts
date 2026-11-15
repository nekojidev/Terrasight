import type { YearSetComparison } from "@terrasight/shared";

/**
 * Source of the year-set comparison for the `get_year_set_ranking` tool. The scenarios module owns the computation;
 * it is bound to this token in a module that sees both (until then the tool answers "not available").
 */
export interface YearSetComparisonProvider {
  compare(workspaceId: string, fieldId: string): Promise<YearSetComparison | null>;
}

export const YEAR_SET_COMPARISON_PROVIDER = Symbol("YEAR_SET_COMPARISON_PROVIDER");
