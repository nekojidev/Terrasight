"use client";

import { useQuery } from "@tanstack/react-query";
import { useToast } from "@terrasight/ui";
import { CornerDownLeft, FileText, Map, MapPin, MessageSquare, Play, RefreshCw, Search, Settings, Sparkles, Wind, X, Home } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useOpenAsk } from "@/lib/ask";
import { api } from "@/lib/api";
import {
  buildItems,
  fieldIdFromPath,
  moveIndex,
  pushRecent,
  readRecent,
  type PaletteField,
  type PaletteMode,
  type PaletteGroup,
  type PaletteItem,
  type PalettePage,
} from "@/lib/palette";

interface FieldRow {
  id: string;
  name: string;
  countyName: string | null;
  adminCode: string | null;
}
interface OverviewRow {
  counties: Array<{ fields: Array<{ fieldId: string; lastCrop: { en: string; uk: string } | null }> }>;
}

const PAGE_ICONS: Record<string, ReactNode> = {
  today: <Home />,
  fields: <Map />,
  analyze: <Play />,
  decisions: <FileText />,
  windows: <Wind />,
  rotation: <RefreshCw />,
  assistant: <Sparkles />,
  settings: <Settings />,
};

/**
 * ⌘K / Ctrl+K command palette: one input; matching fields, pages and actions as you type, and always a row that
 * asks the assistant. Combobox + listbox pattern (focus stays in the input, `aria-activedescendant` follows the row).
 */
export function CommandPalette({
  workspaceId,
  role,
  open,
  onClose,
}: {
  workspaceId: string;
  role: "owner" | "agronomist";
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("App");
  const assistantT = useTranslations("Assistant");
  const locale = useLocale();
  const lang = locale === "uk" ? "uk" : "en";
  const router = useRouter();
  const path = usePathname();
  const openAsk = useOpenAsk();
  const [mode, setMode] = useState<PaletteMode>("ask");
  const toast = useToast();
  const uid = useId();
  const listId = `${uid}-list`;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  const fieldsQ = useQuery({
    queryKey: ["fields", workspaceId],
    queryFn: () => api<FieldRow[]>(`/api/w/${workspaceId}/fields`),
    enabled: open,
  });
  // Crops come from the overview; the palette works without them.
  const cropsQ = useQuery({
    queryKey: ["palette-crops", workspaceId],
    queryFn: () => api<OverviewRow>(`/api/w/${workspaceId}/fields-overview`),
    enabled: open,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const fields = useMemo<PaletteField[]>(() => {
    const crops = new globalThis.Map<string, string>();
    for (const c of cropsQ.data?.counties ?? [])
      for (const f of c.fields) if (f.lastCrop) crops.set(f.fieldId, f.lastCrop[lang]);
    return (fieldsQ.data ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      place: [f.countyName, f.adminCode].filter(Boolean).join(", "),
      crop: crops.get(f.id) ?? "",
    }));
  }, [fieldsQ.data, cropsQ.data, lang]);

  const pages = useMemo<PalettePage[]>(
    () => [
      { id: "analyze", label: assistantT("k1"), action: "analyze", keywords: "run check refresh" },
      { id: "decisions", label: t("navDecisions"), href: "/decisions", keywords: "owner questions" },
      { id: "windows", label: t("navWorkWindows"), href: "/work-windows", keywords: "spray sow harvest" },
      { id: "worklog", label: t("navWorkLog"), href: "/fields", keywords: "log history events field" },
      { id: "rotation", label: t("navPlan"), href: "/rotation", keywords: "rotation plan crops" },
      {
        id: "settings",
        label: t("navSettings"),
        href: role === "owner" ? "/settings/workspace" : "/settings/account",
        keywords: "account company team prices",
      },
      { id: "today", label: t("navToday"), href: "/" },
      { id: "fields", label: t("navFields"), href: "/fields" },
      { id: "assistant", label: t("navAssistant"), href: "/assistant" },
    ],
    [t, assistantT, role],
  );

  const recent = useMemo(
    () => recentIds.map((id) => fields.find((f) => f.id === id)).filter((f): f is PaletteField => Boolean(f)),
    [recentIds, fields],
  );
  const items = useMemo(
    () =>
      buildItems({
        query,
        fields,
        pages,
        recent,
        suggestions: [t("aiSugg1"), t("paletteSugg2"), t("aiSugg3")],
        mode,
      }),
    [query, fields, pages, recent, t, mode],
  );

  // Open: clean state, remember where focus was, lock page scroll; close: give focus back.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setMode("ask");
    setActive(0);
    setRecentIds(readRecent(workspaceId));
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    input.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, workspaceId]);
  useEffect(() => setActive(0), [query, mode]);
  useEffect(() => {
    if (open) document.getElementById(`${uid}-opt-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, open, uid, items.length]);

  if (!open) return null;

  function ask(text: string) {
    onClose();
    // The question goes to the composer of the assistant page, not sent; on a field page that field stays the context.
    openAsk(text, { fieldId: fieldIdFromPath(path) });
  }
  async function analyze() {
    try {
      await api(`/api/w/${workspaceId}/analysis-runs`, { body: {} });
      toast.show(t("paletteAnalyze"), "info");
    } catch {
      toast.show(t("errGeneric"), "error");
    }
  }
  function choose(item: PaletteItem | undefined) {
    if (!item) return;
    if (item.kind === "ask") return ask(item.text);
    onClose();
    if (item.kind === "field") {
      pushRecent(workspaceId, item.field.id);
      router.push(`/fields/${item.field.id}`);
    } else if (item.page.action === "analyze") void analyze();
    else if (item.page.href) router.push(item.page.href);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.target === input.current) {
      e.preventDefault();
      setActive((i) => moveIndex(i, items.length, e.key));
    } else if (e.key === "Enter" && e.target === input.current && !e.nativeEvent.isComposing) {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === "Tab") {
      // Focus trap: the input and the close button are the only stops.
      const stops = Array.from(dialog.current?.querySelectorAll<HTMLElement>("input, button") ?? []);
      const first = stops[0];
      const last = stops.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  }

  const groupLabel: Record<PaletteGroup, string> = {
    ask: t("paletteGroupAsk"),
    recent: t("paletteRecent"),
    suggest: t("paletteSuggested"),
    fields: t("paletteAllFields"),
    pages: t("palettePages"),
  };
  // Consecutive items of one group share a heading.
  const rows: Array<{ item: PaletteItem; index: number; heading: string | null }> = items.map((item, index) => ({
    item,
    index,
    heading: index === 0 || items[index - 1]!.group !== item.group ? groupLabel[item.group] || null : null,
  }));

  return (
    <div className="fixed inset-0 z-50" onKeyDown={onKeyDown}>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 hidden bg-ink/40 sm:block dark:bg-bg/70"
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t("paletteTitle")}
        className="absolute inset-0 flex flex-col bg-surface sm:inset-x-auto sm:top-[10vh] sm:left-1/2 sm:max-h-[min(640px,76vh)] sm:w-[640px] sm:max-w-[calc(100vw-32px)] sm:-translate-x-1/2 sm:rounded-card sm:shadow-sheet"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          {mode === "ask" ? (
            <Sparkles aria-hidden className="size-5 shrink-0 text-ink" strokeWidth={1.7} />
          ) : (
            <Search aria-hidden className="size-5 shrink-0 text-ink-3" strokeWidth={1.7} />
          )}
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={items.length ? `${uid}-opt-${active}` : undefined}
            aria-label={t("paletteInput")}
            placeholder={mode === "ask" ? t("searchPh") : t("paletteFindPh")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={2000}
            autoComplete="off"
            spellCheck={false}
            className="min-h-14 min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-3"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={t("paletteClose")}
            className="focus-ring inline-flex size-11 shrink-0 items-center justify-center rounded-btn text-ink-2 hover:bg-surface-2"
          >
            <X aria-hidden className="size-5" strokeWidth={1.7} />
          </button>
        </div>
        <div role="group" aria-label={t("paletteModes")} className="flex gap-2 px-4 pt-2">
          {(["ask", "go"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m);
                input.current?.focus();
              }}
              className={`focus-ring min-h-tap rounded-btn px-3 text-body font-semibold ${mode === m ? "bg-muted text-ink" : "text-ink-2"}`}
            >
              {m === "ask" ? t("paletteModeAsk") : t("paletteModeGo")}
            </button>
          ))}
        </div>
        <div id={listId} role="listbox" aria-label={t("paletteTitle")} className="min-h-0 flex-1 overflow-y-auto p-2">
          {rows.map(({ item, index, heading }) => {
            const selected = index === active;
            return (
              <div key={item.id} role="presentation">
                {heading && (
                  <p role="presentation" className="px-3 pt-3 pb-1 font-mono text-micro tracking-wide text-ink-3 uppercase">
                    {heading}
                  </p>
                )}
                <div
                  id={`${uid}-opt-${index}`}
                  role="option"
                  aria-selected={selected}
                  onMouseMove={() => selected || setActive(index)}
                  onClick={() => choose(item)}
                  className={`flex min-h-tap cursor-pointer items-center gap-3 rounded-input px-3 py-2 text-body text-ink ${selected ? "bg-muted" : ""}`}
                >
                  <span aria-hidden className="shrink-0 text-ink-2 [&>svg]:size-5 [&>svg]:stroke-[1.7]">
                    {item.kind === "ask" ? (
                      item.group === "ask" ? <MessageSquare /> : <Sparkles />
                    ) : item.kind === "field" ? (
                      <MapPin />
                    ) : (
                      (PAGE_ICONS[item.page.id] ?? <FileText />)
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    {item.kind === "ask" ? (
                      <span className={`block break-words ${item.group === "ask" ? "line-clamp-2 font-semibold" : ""}`}>
                        {item.group === "ask" ? t("paletteAsk", { q: item.text }) : item.text}
                      </span>
                    ) : item.kind === "field" ? (
                      <>
                        <span className="block truncate font-semibold">{item.field.name}</span>
                        {(item.field.place || item.field.crop) && (
                          <span className="block truncate text-small text-ink-2">
                            {[item.field.place, item.field.crop].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="block truncate">{item.page.label}</span>
                    )}
                  </span>
                  {selected && (
                    <CornerDownLeft aria-hidden className="hidden size-4 shrink-0 text-ink-3 sm:block" strokeWidth={1.7} />
                  )}
                </div>
              </div>
            );
          })}
          {query.trim() && items.length === 1 && (
            <p className="px-3 py-3 text-small text-ink-2">{t("paletteNone")}</p>
          )}
        </div>
        <p className="hidden border-t border-line px-4 py-2 text-small text-ink-3 sm:block">{t("paletteKeys")}</p>
      </div>
    </div>
  );
}
