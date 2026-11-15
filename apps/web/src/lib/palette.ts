/** Command palette (⌘K): pure filtering, ordering and keyboard helpers; the dialog itself is components/CommandPalette. */
type Store = Pick<Storage, "getItem" | "setItem">;

export interface PaletteField {
  id: string;
  name: string;
  /** County / oblast line. */
  place: string;
  crop: string;
}
export interface PalettePage {
  id: string;
  label: string;
  href?: string;
  /** Runs instead of navigating (e.g. "Analyze fields"). */
  action?: "analyze";
  /** Extra words that find the page. */
  keywords?: string;
}

export type PaletteGroup = "ask" | "recent" | "suggest" | "fields" | "pages";
export type PaletteItem =
  | { group: "ask" | "suggest"; id: string; kind: "ask"; text: string }
  | { group: "fields" | "recent"; id: string; kind: "field"; field: PaletteField }
  | { group: "pages"; id: string; kind: "page"; page: PalettePage };

/** Lower-case, accents and apostrophes dropped, so "Поле" finds "поле" and "Zaporizka" finds "Zaporizka". */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[’'`ʼ]/g, "")
    .toLowerCase()
    .trim();
}

const tokens = (q: string): string[] => norm(q).split(/\s+/).filter(Boolean);

/** Every word of the query must appear somewhere in the text. */
function matches(text: string, q: string): boolean {
  const hay = norm(text);
  return tokens(q).every((t) => hay.includes(t));
}

/** Fields whose name, place or crop match; name matches first (prefix before substring), then list order. */
export function filterFields(fields: PaletteField[], q: string, limit = 6): PaletteField[] {
  const query = norm(q);
  if (!query) return [];
  const rank = (f: PaletteField): number => {
    const name = norm(f.name);
    return name.startsWith(query) ? 0 : name.includes(query) ? 1 : 2;
  };
  return fields
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => matches(`${f.name} ${f.place} ${f.crop}`, q))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .slice(0, limit)
    .map(({ f }) => f);
}

export function filterPages(pages: PalettePage[], q: string): PalettePage[] {
  if (!norm(q)) return [];
  return pages.filter((p) => matches(`${p.label} ${p.keywords ?? ""}`, q));
}

/**
 * The rows for the current input. Typing: the "Ask the assistant" row is always first, then matching fields, then
 * pages and actions. Empty input: recent fields, then suggested questions.
 */
export function buildItems(o: {
  query: string;
  fields: PaletteField[];
  pages: PalettePage[];
  recent: PaletteField[];
  suggestions: string[];
}): PaletteItem[] {
  const q = o.query.trim();
  if (!q) {
    return [
      ...o.recent.map((field): PaletteItem => ({ group: "recent", id: `recent:${field.id}`, kind: "field", field })),
      ...o.suggestions.map((text): PaletteItem => ({ group: "suggest", id: `suggest:${text}`, kind: "ask", text })),
    ];
  }
  return [
    { group: "ask", id: "ask", kind: "ask", text: q },
    ...filterFields(o.fields, q).map((field): PaletteItem => ({ group: "fields", id: `field:${field.id}`, kind: "field", field })),
    ...filterPages(o.pages, q).map((page): PaletteItem => ({ group: "pages", id: `page:${page.id}`, kind: "page", page })),
  ];
}

/** ↑/↓ move through the rows and wrap; Home/End jump. Returns the new index, or the same one for other keys. */
export function moveIndex(index: number, count: number, key: string): number {
  if (count <= 0) return -1;
  if (key === "ArrowDown") return index < 0 ? 0 : (index + 1) % count;
  if (key === "ArrowUp") return index <= 0 ? count - 1 : index - 1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return index;
}

const RECENT_MAX = 5;
const recentKey = (workspaceId: string) => `ts:recent-fields:${workspaceId}`;
function local(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readRecent(workspaceId: string, store: Store | null = local()): string[] {
  try {
    const raw = JSON.parse(store?.getItem(recentKey(workspaceId)) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Puts a field first in the recent list (no duplicates, at most five). */
export function pushRecent(workspaceId: string, fieldId: string, store: Store | null = local()): string[] {
  const next = [fieldId, ...readRecent(workspaceId, store).filter((x) => x !== fieldId)].slice(0, RECENT_MAX);
  try {
    store?.setItem(recentKey(workspaceId), JSON.stringify(next));
  } catch {
    /* recents are a convenience */
  }
  return next;
}

/** The field id of a `/fields/<uuid>` path, or null elsewhere (`/fields/new` is not a field). */
export function fieldIdFromPath(path: string): string | null {
  return /^\/fields\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/|$)/i.exec(path)?.[1] ?? null;
}
