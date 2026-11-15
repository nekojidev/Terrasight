"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BottomSheet, Button, ConfirmDialog, Kicker, Surface } from "@terrasight/ui";
import { History, MessageSquare, MoreHorizontal, Play, Plus, ScanSearch, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chat } from "@/components/Chat";
import { QueryState } from "@/components/QueryState";
import { api } from "@/lib/api";
import { useActionToast } from "@/lib/useActionToast";
import { useFormat } from "@/lib/useFormat";
import {
  clearActive,
  distinctTitles,
  latestForFieldPath,
  readActive,
  suggestionKeys,
  writeActive,
} from "@/lib/assistant-context";

interface FieldRow {
  id: string;
  name: string;
}
interface Item {
  id: string;
  title: string | null;
  contextFieldId: string | null;
  createdAt: string;
}

/**
 * Conversation list + chat (design 14). Opens the last conversation of this tab (or the newest); with `?field=` the
 * field's latest chat (or a new one); with `?q=` the question is sent into it.
 */
export function AssistantClient({
  workspaceId,
  fieldCount,
  context: contextProp,
  question,
  ask,
}: {
  workspaceId: string;
  fieldCount: number;
  context: { fieldId?: string; recommendationId?: string };
  question?: string;
  /** A question for the composer (`?ask=`): shown, focused, not sent. */
  ask?: string;
}) {
  const t = useTranslations("Assistant");
  const app = useTranslations("App");
  const client = useQueryClient();
  const router = useRouter();
  const { fail } = useActionToast();
  const fmt = useFormat();
  // The address loses ?ask= and ?field= once they are used; the field stays the context of this page.
  const [context, setContext] = useState(contextProp);
  useEffect(() => {
    if (contextProp.fieldId || contextProp.recommendationId) setContext(contextProp);
  }, [contextProp.fieldId, contextProp.recommendationId]);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [noContext, setNoContext] = useState(false);
  const key = ["conversations", workspaceId];
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<Item[]>(`/api/w/${workspaceId}/conversations`),
    // The list also shows titles that the first question just created.
    refetchOnMount: "always",
  });
  const locale = useLocale();
  const lang = locale === "uk" ? "uk" : "en";
  const [current, setCurrent] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fields = useQuery({
    queryKey: ["fields", workspaceId],
    queryFn: () => api<FieldRow[]>(`/api/w/${workspaceId}/fields`),
  });
  const hasContext = Boolean(context.fieldId || context.recommendationId);
  const convField = list.data?.find((c) => c.id === current)?.contextFieldId ?? undefined;
  // Questions in an open chat carry the field it was opened from (or the page's context).
  const chatContext = noContext ? {} : hasContext ? context : convField ? { fieldId: convField } : {};
  const fieldName = fields.data?.find((f) => f.id === (chatContext.fieldId ?? ""))?.name;

  /** The chip texts: about the field, about its recommendation, or company-wide. */
  const suggestions = useMemo(
    () => suggestionKeys({ fieldId: chatContext.fieldId, recommendationId: noContext ? undefined : context.recommendationId }).map((k) => t(`sugg.${k}` as never)),
    [t, chatContext.fieldId, context.recommendationId, noContext],
  );

  const titles = useMemo(
    () =>
      distinctTitles(
        list.data ?? [],
        (id) => fields.data?.find((f) => f.id === id)?.name,
        (iso) => fmt.date(iso, "short"),
        t("new"),
      ),
    [list.data, fields.data, fmt, t],
  );
  const groups = useMemo(() => {
    const today = fmt.date(new Date(), "full");
    const all = list.data ?? [];
    return [
      { key: "asToday", rows: all.filter((c) => fmt.date(c.createdAt, "full") === today) },
      { key: "asEarlier", rows: all.filter((c) => fmt.date(c.createdAt, "full") !== today) },
    ].filter((g) => g.rows.length > 0);
  }, [list.data, fmt]);

  /** Opens a chat and remembers it for this page's context, so coming back restores it. */
  const choose = useCallback(
    (id: string) => {
      setCurrent(id);
      setNoContext(false);
      setSheet(false);
      writeActive(workspaceId, context.fieldId, id);
    },
    [workspaceId, context.fieldId],
  );

  async function start() {
    try {
      const c = await api<{ id: string }>(`/api/w/${workspaceId}/conversations`, {
        body: context.fieldId ? { fieldId: context.fieldId } : {},
      });
      await client.invalidateQueries({ queryKey: key });
      choose(c.id);
    } catch (e) {
      fail(e, t("newFail"), () => void start());
    }
  }
  const [ran, setRan] = useState<"idle" | "busy" | "done" | "error">("idle");
  async function analyze() {
    setRan("busy");
    try {
      await api(`/api/w/${workspaceId}/analysis-runs`, { body: {} });
      void client.invalidateQueries({ queryKey: ["brief", workspaceId] });
      setRan("done");
    } catch (e) {
      setRan("error");
      fail(e, t("analyzeFail"), () => void analyze());
    }
  }

  /** A chat is gone (deleted here, or expired): forget it and open the next one, or a fresh one. */
  const handled = useRef<string | null>(null);
  function forget(id: string) {
    if (handled.current === id) return;
    handled.current = id;
    for (const f of [undefined, context.fieldId, convField])
      if (readActive(workspaceId, f) === id) clearActive(workspaceId, f);
    if (current === id) {
      const next = list.data?.find((c) => c.id !== id);
      if (next) choose(next.id);
      else {
        setCurrent(null);
        void start();
      }
    }
    void client.invalidateQueries({ queryKey: ["conversations", workspaceId] });
  }
  async function remove() {
    const id = toDelete;
    if (!id) return;
    setDeleting(true);
    try {
      await api(`/api/w/${workspaceId}/conversations/${id}`, { method: "DELETE" });
      forget(id);
      setToDelete(null);
    } catch (e) {
      fail(e, t("deleteFail"), () => void remove());
    } finally {
      setDeleting(false);
    }
  }

  // Pick the thread once the list is known.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !list.data) return;
    opened.current = true;
    void (async () => {
      if (context.fieldId) {
        // A field: its remembered or latest chat, else a new one.
        let id = readActive(workspaceId, context.fieldId);
        if (!id) {
          try {
            id = (await api<Array<{ id: string }>>(latestForFieldPath(workspaceId, context.fieldId)))[0]?.id ?? null;
          } catch {
            id = null;
          }
        }
        if (id) choose(id);
        else await start();
      } else if (context.recommendationId || list.data!.length === 0) {
        await start();
      } else {
        const stored = readActive(workspaceId, undefined);
        choose(list.data!.some((c) => c.id === stored) ? stored! : list.data![0]!.id);
      }
    })();
  }, [list.data]);

  // `?q=`: send the question into the chat that just opened, once, and take it out of the address.
  const sentFor = useRef<string | null>(null);
  useEffect(() => {
    if (!question) {
      sentFor.current = null;
      return;
    }
    if (!current || sentFor.current === question) return;
    sentFor.current = question;
    const params = new URLSearchParams();
    if (context.fieldId) params.set("field", context.fieldId);
    if (context.recommendationId) params.set("rec", context.recommendationId);
    router.replace(`/assistant${params.toString() ? `?${params}` : ""}`);
    void api(`/api/w/${workspaceId}/conversations/${current}/messages`, {
      body: { text: question, context: chatContext, lang },
    })
      .then(() => {
        void client.invalidateQueries({ queryKey: ["conversation", workspaceId, current] });
        void client.invalidateQueries({ queryKey: key });
      })
      .catch((e) => fail(e, t("sendFail")));
  }, [current, question]);

  // `?ask=`: place the question in the composer once the chat has opened, focus it, never send it.
  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ask) {
      askedFor.current = null;
      return;
    }
    if (!current || askedFor.current === ask) return;
    askedFor.current = ask;
    setPrefill({ text: ask, nonce: Date.now() });
    router.replace("/assistant");
  }, [current, ask]);

  const historyList = (
    <>
      {!list.data && <QueryState query={list} skeletonVariant="rows" what={t("hist")}>{() => null}</QueryState>}
      {groups.map((g) => (
        <div key={g.key} className="flex flex-col gap-1">
          <Kicker as="h3" className="px-3 pt-1">
            {app(g.key)}
          </Kicker>
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {g.rows.map((c) => {
              const title = titles.get(c.id) ?? t("new");
              return (
                <li
                  key={c.id}
                  className={`flex items-center gap-1 rounded-input pl-3 ${current === c.id ? "bg-muted" : "hover:bg-muted"}`}
                >
                  <button
                    type="button"
                    aria-current={current === c.id ? "true" : undefined}
                    onClick={() => choose(c.id)}
                    className="focus-ring flex min-h-tap min-w-0 flex-1 items-center gap-2 text-left text-small text-ink"
                  >
                    <MessageSquare aria-hidden className="size-4 shrink-0 text-ink-3" strokeWidth={1.7} />
                    <span className={`line-clamp-2 break-words ${current === c.id ? "font-semibold" : ""}`}>{title}</span>
                  </button>
                  {menuFor === c.id ? (
                    <button
                      type="button"
                      aria-label={t("deleteChat", { title })}
                      onClick={() => {
                        setMenuFor(null);
                        setToDelete(c.id);
                      }}
                      onBlur={() => setMenuFor(null)}
                      autoFocus
                      className="focus-ring inline-flex min-h-tap shrink-0 items-center gap-1.5 rounded-btn px-3 text-caption font-semibold text-urgent"
                    >
                      <Trash2 aria-hidden className="size-4" strokeWidth={1.7} />
                      {t("deleteShort")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label={t("rowMenu")}
                      aria-expanded={false}
                      onClick={() => setMenuFor(c.id)}
                      className="focus-ring inline-flex size-11 shrink-0 items-center justify-center rounded-btn text-ink-3 hover:text-ink"
                    >
                      <MoreHorizontal aria-hidden className="size-4" strokeWidth={1.7} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="hidden flex-col gap-3 lg:flex">
        <Button variant="outline" icon={<Plus />} onClick={() => void start()}>
          {t("new")}
        </Button>
        <Kicker as="h2" className="mt-2">
          {t("hist")}
        </Kicker>
        {historyList}
        <Kicker as="h2" className="mt-4">
          {t("do")}
        </Kicker>
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            icon={<Play />}
            onClick={() => void analyze()}
            disabled={ran === "busy"}
            aria-busy={ran === "busy"}
            className="justify-start"
          >
            {t("doAnalyze")}
          </Button>
          {ran === "done" && (
            <p role="status" className="text-caption text-ok">
              {t("analyzeStarted")}
            </p>
          )}
        </div>
      </aside>
      <Surface as="section" pad="sm" className="min-w-0 lg:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-chip bg-muted pl-3 text-caption font-semibold text-ink">
            <ScanSearch aria-hidden className="size-4 shrink-0" strokeWidth={1.7} />
            <span className="truncate py-1.5">
              {chatContext.fieldId && fieldName
                ? t("about", { name: fieldName })
                : hasContext && !noContext
                  ? t("aboutThis")
                  : t("aboutAll", { n: fieldCount })}
            </span>
            {chatContext.fieldId && fieldName ? (
              <button
                type="button"
                aria-label={t("removeAbout")}
                title={t("removeAbout")}
                onClick={() => setNoContext(true)}
                className="focus-ring inline-flex size-11 shrink-0 items-center justify-center rounded-chip text-ink-2 hover:text-ink"
              >
                <X aria-hidden className="size-4" strokeWidth={1.7} />
              </button>
            ) : (
              <span className="w-2" />
            )}
          </span>
          <Button variant="outline" icon={<History />} className="lg:hidden" onClick={() => setSheet(true)}>
            {t("history")}
          </Button>
        </div>
        {current && (
          <Chat
            key={current}
            workspaceId={workspaceId}
            conversationId={current}
            context={chatContext}
            suggestions={suggestions}
            placeholder={fieldName ? app("faPlaceholder", { name: fieldName }) : undefined}
            prefill={prefill}
            onMissing={() => forget(current)}
            autoFocus
          />
        )}
      </Surface>
      <BottomSheet
        open={sheet}
        title={t("historyTitle")}
        primaryLabel={t("newShort")}
        cancelLabel={t("close")}
        onPrimary={() => {
          setSheet(false);
          void start();
        }}
        onClose={() => setSheet(false)}
      >
        <div className="flex max-h-[50dvh] flex-col gap-3 overflow-y-auto">{historyList}</div>
      </BottomSheet>
      <ConfirmDialog
        open={toDelete !== null}
        title={app("aiDeleteTitle")}
        confirmLabel={app("aiDeleteConfirm")}
        cancelLabel={app("cancel")}
        busy={deleting}
        onCancel={() => setToDelete(null)}
        onConfirm={() => void remove()}
      >
        {app("aiDeleteBody")}
      </ConfirmDialog>
    </div>
  );
}
