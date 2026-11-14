// @terrasight/evaluators: evaluator kinds, pest-model trees, confidence rule (RFC §10.3, §11; Tech Design §10.1).
export * from "./types.js";
export { combine, evalNode } from "./kinds.js";
export {
  confidence,
  evaluate,
  modelApplies,
  modelCovers,
  nextFrost,
  resolver,
  snapshotHash,
  stableStringify,
  winterWheatStage,
  type SeasonStage,
} from "./evaluate.js";
export {
  classifyUrgency,
  compareItems,
  daysUntil,
  localDay,
  PLANNING_LEAD_DAYS,
  type Urgency,
  type UrgencyItem,
} from "./urgency.js";
