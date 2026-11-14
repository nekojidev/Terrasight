/**
 * Workspace isolation guard (Tech Design §5.2): every query on a workspace-scoped table must filter by
 * `workspaceId` (or set it, for creates). Queries that don't are rejected before they reach the database.
 *
 * System jobs that legitimately work across workspaces (the 06:00 scheduler, retention) use the unscoped
 * client on purpose (`PrismaService.system`).
 */
export const SCOPED_MODELS = new Set([
  "Field",
  "AnalysisRun",
  "Recommendation",
  "ReportItem",
  "Conversation",
  "AuditLog",
]);

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

function hasWorkspace(where: unknown): boolean {
  if (!where || typeof where !== "object") return false;
  const w = where as Record<string, unknown>;
  const v = w.workspaceId;
  if (typeof v === "string") return true;
  if (v && typeof v === "object" && typeof (v as { equals?: unknown }).equals === "string") return true;
  // AND: [{ workspaceId }, …]
  if (Array.isArray(w.AND)) return w.AND.some(hasWorkspace);
  return false;
}

function createHasWorkspace(data: unknown): boolean {
  if (Array.isArray(data)) return data.length > 0 && data.every(createHasWorkspace);
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (typeof d.workspaceId === "string") return true;
  const ws = d.workspace as { connect?: { id?: unknown } } | undefined;
  return typeof ws?.connect?.id === "string";
}

/** Throws WorkspaceScopeError when a scoped model is queried without a workspace filter. */
export function assertWorkspaceScope(model: string | undefined, operation: string, args: unknown): void {
  if (!model || !SCOPED_MODELS.has(model)) return;
  const a = (args ?? {}) as Record<string, unknown>;
  if (CREATES.has(operation)) {
    if (!createHasWorkspace(a.data)) throw new WorkspaceScopeError(model, operation);
    return;
  }
  if (READ_WRITE_WHERE.has(operation)) {
    if (!hasWorkspace(a.where)) throw new WorkspaceScopeError(model, operation);
    if (operation === "upsert" && !createHasWorkspace(a.create))
      throw new WorkspaceScopeError(model, operation);
  }
}
