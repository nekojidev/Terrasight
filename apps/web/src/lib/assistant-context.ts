/**
 * Which assistant conversation is active per context: one per field and one company-wide ("global").
 * The server is the source of truth (the latest chat of the user for a field); sessionStorage only remembers the
 * choice made in this tab, e.g. an older chat picked from the list, so coming back restores exactly that thread.
 */
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const activeKey = (workspaceId: string, fieldId?: string | null): string =>
  `ts:assistant:${workspaceId}:${fieldId || "global"}`;

function browserStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The remembered conversation id for this context, or null (also when storage is blocked or the value is junk). */
export function readActive(workspaceId: string, fieldId?: string | null, store: Store | null = browserStore()): string | null {
  try {
    const v = store?.getItem(activeKey(workspaceId, fieldId)) ?? null;
    return v && UUID.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeActive(
  workspaceId: string,
  fieldId: string | null | undefined,
  conversationId: string,
  store: Store | null = browserStore(),
): void {
  try {
    store?.setItem(activeKey(workspaceId, fieldId), conversationId);
  } catch {
    /* private mode or quota: the server's "latest" still restores the thread */
  }
}

export function clearActive(workspaceId: string, fieldId?: string | null, store: Store | null = browserStore()): void {
  try {
    store?.removeItem(activeKey(workspaceId, fieldId));
  } catch {
    /* nothing to clear */
  }
}

/** The thread to open: this tab's remembered one, else the server's latest for the context, else none. */
export function pickActive(stored: string | null, latest: string | null | undefined): string | null {
  return stored ?? latest ?? null;
}

/** API path of the latest-chat lookup for a field. */
export const latestForFieldPath = (workspaceId: string, fieldId: string): string =>
  `/api/w/${workspaceId}/conversations?fieldId=${encodeURIComponent(fieldId)}`;

/** A one-line title from the first question, as the server does it (whitespace collapsed, 60 characters). */
export function titleFromQuestion(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= 60 ? t : `${t.slice(0, 59).trimEnd()}…`;
}

export { askHref } from "./ask-link";

/** Where the evidence of an answer lives, from the tools it called and their arguments (field aliases F<n> to ids). */
export type EvidenceLink = { kind: "recommendation" | "rotation" | "field"; href: string; fieldId?: string };

export function evidenceLink(
  tools: Array<{ tool: string; args?: unknown }>,
  aliases: Record<string, { id?: string; name: string }>,
): EvidenceLink | null {
  const fieldOf = (args: unknown): string | undefined => {
    const f = (args as { field?: unknown } | null)?.field;
    return typeof f === "string" ? aliases[f]?.id : undefined;
  };
  for (const t of tools) {
    const id = (t.args as { id?: unknown } | null)?.id;
    if (t.tool === "explain_recommendation" && typeof id === "string" && UUID.test(id))
      return { kind: "recommendation", href: `/recommendations/${id}` };
  }
  for (const t of tools) {
    const f = fieldOf(t.args);
    if (t.tool === "get_year_set_ranking" && f) return { kind: "rotation", href: `/fields/${f}/rotation`, fieldId: f };
  }
  for (const t of tools) {
    const f = fieldOf(t.args);
    if (
      f &&
      ["get_field_summary", "get_field_history", "get_weather", "get_forecast", "get_climate_shift", "run_risk_model"].includes(t.tool)
    )
      return { kind: "field", href: `/fields/${f}`, fieldId: f };
  }
  return null;
}

/** Which suggested questions to offer: no field / a field / a field with a recommendation waiting. Keys in `Assistant.sugg`. */
export function suggestionKeys(ctx: { fieldId?: string; recommendationId?: string }): string[] {
  if (ctx.recommendationId) return ["rec1", "rec2", "rec3"];
  if (ctx.fieldId) return ["field1", "field2", "field3"];
  return ["all1", "all2", "all3"];
}

/** History titles that can be told apart: the first question, shortened; repeats get the field or the time. */
export function distinctTitles(
  items: Array<{ id: string; title: string | null; contextFieldId: string | null; createdAt: string }>,
  fieldName: (id: string) => string | undefined,
  time: (iso: string) => string,
  fallback: string,
  max = 48,
): Map<string, string> {
  const short = (s: string) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);
  const base = items.map((c) => short((c.title ?? fallback).replace(/\s+/g, " ").trim()));
  const seen = new Map<string, number>();
  for (const b of base) seen.set(b, (seen.get(b) ?? 0) + 1);
  const out = new Map<string, string>();
  items.forEach((c, i) => {
    const b = base[i]!;
    if ((seen.get(b) ?? 0) < 2) return void out.set(c.id, b);
    const extra = (c.contextFieldId && fieldName(c.contextFieldId)) || time(c.createdAt);
    out.set(c.id, `${b} · ${extra}`);
  });
  return out;
}
