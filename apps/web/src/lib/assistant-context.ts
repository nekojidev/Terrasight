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
