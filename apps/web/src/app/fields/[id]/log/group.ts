/** Groups entries (already newest first) under a label per day, keeping the order. */
export function groupBy<T>(items: T[], label: (item: T) => string): Array<{ label: string; items: T[] }> {
  const groups: Array<{ label: string; items: T[] }> = [];
  for (const item of items) {
    const l = label(item);
    const last = groups[groups.length - 1];
    if (last && last.label === l) last.items.push(item);
    else groups.push({ label: l, items: [item] });
  }
  return groups;
}

/** Translated crop name; never the raw library key. */
export function cropLabel(
  key: unknown,
  names: Record<string, { en: string; uk: string }> | undefined,
  locale: "en" | "uk",
  fallback: string,
): string {
  const n = typeof key === "string" ? names?.[key] : undefined;
  return n ? n[locale] : fallback;
}
