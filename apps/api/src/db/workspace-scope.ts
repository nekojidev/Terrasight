/**
 * Workspace isolation guard (Tech Design §5.2): every query on a workspace-scoped table must filter by
 * `workspaceId` (or set it, for creates). Queries that don't are rejected before they reach the database.
 *
 * System jobs that legitimately work across workspaces (the 06:00 scheduler, retention) use the unscoped
 * client on purpose (`PrismaService.system`).
 */
/**
 * Models with a direct `workspaceId` column. Without a request workspace context the query must carry a
 * `workspaceId` key; inside a `/w/:ws` request (see request-context.ts) its value must equal the caller's.
 */
export const SCOPED_MODELS = new Set([
  "Field",
  "AnalysisRun",
  "Recommendation",
  "ReportItem",
  "Conversation",
  "AuditLog",
  "Notification",
  "WorkspaceCropPrice",
]);

/**
 * Models that reach a workspace only through a relation. Inside a `/w/:ws` request every read/update/delete
 * gets this relation filter ANDed in, so another workspace's rows are simply not found.
 */
export const RELATION_SCOPED: Record<string, Record<string, unknown>> = {
  CropSeason: { field: true },
  SeasonRecord: { field: true },
  FieldHistory: { field: true },
  GatherJob: { field: true },
  GatherTask: { job: { field: true } },
  ScenarioRun: { field: true },
  Plan: { field: true },
  ScoutingTask: { field: true },
  ScoutingPoint: { task: { field: true } },
  ScoutingPhoto: { task: { field: true } },
  FieldZone: { field: true },
  FieldZoneBuild: { field: true },
  AnalysisRunField: { run: true },
  RecommendationLevel: { recommendation: true },
  Outcome: { recommendation: true },
  ReportReply: { reportItem: true },
  OwnerAnswer: { reportItem: true },
  Message: { conversation: true },
  ToolCall: { message: { conversation: true } },
};

/** Builds `{ field: { workspaceId } }` / `{ job: { field: { workspaceId } } }` from a path template. */
function relationFilter(path: Record<string, unknown>, workspaceId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(path)) {
    out[k] = v === true ? { workspaceId } : relationFilter(v as Record<string, unknown>, workspaceId);
  }
  return out;
}

const READ_WRITE_WHERE = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

const CREATES = new Set(["create", "createMany", "createManyAndReturn"]);

export class WorkspaceScopeError extends Error {
  constructor(model: string, operation: string) {
    super(`${model}.${operation} must be scoped by workspaceId (Tech Design §5.2)`);
    this.name = "WorkspaceScopeError";
  }
}

/** Collects every `workspaceId` value a where clause pins (top level, `equals`, and AND branches). */
function workspaceValues(where: unknown, out: unknown[] = []): unknown[] {
  if (!where || typeof where !== "object") return out;
  const w = where as Record<string, unknown>;
  const v = w.workspaceId;
  if (typeof v === "string") out.push(v);
  else if (v && typeof v === "object" && "equals" in v) out.push((v as { equals?: unknown }).equals);
  else if (v !== undefined) out.push(v);
  if (Array.isArray(w.AND)) for (const x of w.AND) workspaceValues(x, out);
  else if (w.AND) workspaceValues(w.AND, out);
  return out;
}

function hasWorkspace(where: unknown, ws?: string): boolean {
  const vals = workspaceValues(where);
  if (vals.length === 0) return false;
  return ws === undefined ? vals.some((v) => typeof v === "string") : vals.every((v) => v === ws);
}

function createHasWorkspace(data: unknown, ws?: string): boolean {
  if (Array.isArray(data)) return data.length > 0 && data.every((d) => createHasWorkspace(d, ws));
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  const rel = d.workspace as { connect?: { id?: unknown } } | undefined;
  const id = typeof d.workspaceId === "string" ? d.workspaceId : rel?.connect?.id;
  if (typeof id !== "string") return false;
  return ws === undefined || id === ws;
}

/** An update may not move a row to another workspace. */
function dataMovesWorkspace(data: unknown, ws: string): boolean {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (d.workspaceId !== undefined && d.workspaceId !== ws) return true;
  return d.workspace !== undefined;
}

/**
 * Throws WorkspaceScopeError when a scoped model is queried without a workspace filter, or (when the request's
 * workspace `ws` is known) with another workspace's id.
 */
export function assertWorkspaceScope(
  model: string | undefined,
  operation: string,
  args: unknown,
  ws?: string,
): void {
  if (!model || !SCOPED_MODELS.has(model)) return;
  const a = (args ?? {}) as Record<string, unknown>;
  if (CREATES.has(operation)) {
    if (!createHasWorkspace(a.data, ws)) throw new WorkspaceScopeError(model, operation);
    return;
  }
  if (READ_WRITE_WHERE.has(operation)) {
    if (!hasWorkspace(a.where, ws)) throw new WorkspaceScopeError(model, operation);
    if (operation === "upsert" && !createHasWorkspace(a.create, ws))
      throw new WorkspaceScopeError(model, operation);
    if (ws && operation.startsWith("update") && dataMovesWorkspace(a.data, ws))
      throw new WorkspaceScopeError(model, operation);
    if (ws && operation === "upsert" && dataMovesWorkspace(a.update, ws))
      throw new WorkspaceScopeError(model, operation);
  }
}

/**
 * For relation-scoped models inside a request: returns args with the workspace relation filter ANDed into
 * `where`. Other models / no context: args unchanged.
 */
export function scopeRelationArgs(
  model: string | undefined,
  operation: string,
  args: unknown,
  ws: string | undefined,
): unknown {
  if (!model || !ws) return args;
  const path = RELATION_SCOPED[model];
  if (!path || !READ_WRITE_WHERE.has(operation)) return args;
  const a = { ...((args ?? {}) as Record<string, unknown>) };
  const filter = relationFilter(path, ws);
  a.where = a.where ? { AND: [a.where, filter] } : filter;
  return a;
}
