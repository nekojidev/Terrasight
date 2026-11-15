"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ConfirmDialog } from "@terrasight/ui";
import { FileText, MessageSquare, Play, Plus, RefreshCw, ScanSearch, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chat } from "@/components/Chat";
import { QueryState } from "@/components/QueryState";
import { useReportError } from "@/components/useReportError";
import { api } from "@/lib/api";
import { clearActive, latestForFieldPath, readActive, writeActive } from "@/lib/assistant-context";

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
  context,
  question,
}: {
  workspaceId: string;
  fieldCount: number;
  context: { fieldId?: string; recommendationId?: string };
  question?: string;
}) {
  const t = useTranslations("Assistant");
  const app = useTranslations("App");
  const client = useQueryClient();
  const router = useRouter();
  const report = useReportError();
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
  const chatContext = hasContext ? context : convField ? { fieldId: convField } : {};
  const fieldName = fields.data?.find((f) => f.id === (chatContext.fieldId ?? ""))?.name;

  /** The chip texts under the thread: about the chat's field when it has one, company-wide otherwise. */
  const suggestions = useMemo(() => {
    if (chatContext.fieldId) return [app("faSugg1"), app("faSugg2"), app("faSugg3")];
    const f = fields.data ?? [];
    const out = [app("aiSugg1")];
    if (f[0]) out.push(app("asSuggRisk", { name: f[0].name }));
    const x = f[1] ?? f[0];
    if (x) out.push(app("asSuggCrop", { name: x.name }));
    return out;
  }, [fields.data, app, chatContext.fieldId]);

  const groups = useMemo(() => {
    const today = new Date().toDateString();
    const all = list.data ?? [];
    return [
      { key: "asToday", rows: all.filter((c) => new Date(c.createdAt).toDateString() === today) },
      { key: "asEarlier", rows: all.filter((c) => new Date(c.createdAt).toDateString() !== today) },
    ].filter((g) => g.rows.length > 0);
  }, [list.data]);

  /** Opens a chat and remembers it for this page's context, so coming back restores it. */
  const choose = useCallback(
    (id: string) => {
      setCurrent(id);
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
      report(e);
    }
  }
  const [ran, setRan] = useState<"idle" | "busy" | "done" | "error">("idle");
  async function analyze() {
    setRan("busy");
    try {
      await api(`/api/w/${workspaceId}/analysis-runs`, { body: {} });
      void client.invalidateQueries({ queryKey: ["brief", workspaceId] });
      setRan("done");
    } catch {
      setRan("error");
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
      report(e);
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
  const [sendError, setSendError] = useState(false);
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
      .catch(() => setSendError(true));
  }, [current, question]);

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="order-2 flex flex-col gap-3 lg:order-1">
        <Button icon={<Plus />} onClick={() => void start()}>
          {t("new")}
        </Button>
        <h2 className="mt-2 font-mono text-small tracking-wide text-ink-2 uppercase">{t("hist")}</h2>
        {!list.data && <QueryState query={list}>{() => null}</QueryState>}
        {groups.map((g) => (
          <div key={g.key} className="flex flex-col gap-1">
            <h3 className="px-3 pt-1 font-mono text-micro tracking-wide text-ink-3 uppercase">{app(g.key)}</h3>
            <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {g.rows.map((c) => (
                <li
                  key={c.id}
                  className={`group flex items-center gap-2 rounded-input px-3 py-2 ${current === c.id ? "bg-muted" : "hover:bg-muted"}`}
                >
                  <button
                    type="button"
                    aria-current={current === c.id ? "true" : undefined}
                    onClick={() => choose(c.id)}
                    className="focus-ring flex min-h-tap min-w-0 flex-1 items-center gap-2 text-left text-small text-ink"
                  >
                    <MessageSquare aria-hidden className="size-4 shrink-0 text-ink-3" strokeWidth={1.7} />
                    <span className={`line-clamp-2 break-words ${current === c.id ? "font-semibold" : ""}`}>
                      {c.title ?? t("new")}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={app("aiDelete")}
                    title={app("aiDelete")}
                    onClick={() => setToDelete(c.id)}
                    className="focus-ring inline-flex size-9 shrink-0 items-center justify-center rounded-btn text-ink-3 hover:text-ink lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100"
                  >
                    <Trash2 aria-hidden className="size-4" strokeWidth={1.7} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <h2 className="mt-4 font-mono text-small tracking-wide text-ink-2 uppercase">{t("cmds")}</h2>
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            icon={<Play />}
            onClick={() => void analyze()}
            disabled={ran === "busy"}
            aria-busy={ran === "busy"}
            className="justify-start"
          >
            {t("k1")}
          </Button>
          {ran === "done" && (
            <p role="status" className="text-small text-ok">
              {app("aiAnalyzeStarted")}
            </p>
          )}
          {ran === "error" && (
            <p role="alert" className="text-small text-urgent">
              {app("errGeneric")}
            </p>
          )}
          <Link
            href="/decisions"
            className="focus-ring inline-flex min-h-tap items-center gap-2 rounded-btn border border-line-strong px-4 text-body font-semibold text-ink hover:bg-muted"
          >
            <FileText aria-hidden className="size-4" strokeWidth={1.7} />
            {app("decOpen")}
          </Link>
          <Link
            href="/rotation"
            className="focus-ring inline-flex min-h-tap items-center gap-2 rounded-btn border border-line-strong px-4 text-body font-semibold text-ink hover:bg-muted"
          >
            <RefreshCw aria-hidden className="size-4" strokeWidth={1.7} />
            {t("k3")}
          </Link>
        </div>
      </aside>
      <section className="order-1 min-w-0 rounded-card border border-line bg-surface p-4 lg:order-2 lg:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="inline-flex max-w-full items-center gap-2 rounded-chip bg-muted px-3 py-1 text-small font-semibold text-ink">
            <ScanSearch aria-hidden className="size-4 shrink-0" strokeWidth={1.7} />
            <span className="truncate">
              {chatContext.fieldId && fieldName
                ? app("aiContextField", { name: fieldName })
                : hasContext
                  ? app("aiScopeContext")
                  : app("aiScopeAll", { n: fieldCount })}
            </span>
          </span>
        </div>
        {sendError && (
          <p role="alert" className="mb-3 text-small text-urgent">
            {app("errGeneric")}
          </p>
        )}
        {current && (
          <Chat
            key={current}
            workspaceId={workspaceId}
            conversationId={current}
            context={chatContext}
            suggestions={suggestions}
            onMissing={() => forget(current)}
            autoFocus
          />
        )}
      </section>
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
