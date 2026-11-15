"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@terrasight/ui";
import { FileText, MessageSquare, Play, Plus, RefreshCw, ScanSearch, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Chat } from "@/components/Chat";
import { api } from "@/lib/api";

interface FieldRow {
  id: string;
  name: string;
}
interface Item {
  id: string;
  title: string | null;
  createdAt: string;
}

/** Conversation list + chat (design 14). */
export function AssistantClient({
  workspaceId,
  fieldCount,
  context,
}: {
  workspaceId: string;
  fieldCount: number;
  context: { fieldId?: string; recommendationId?: string };
}) {
  const t = useTranslations("Assistant");
  const app = useTranslations("App");
  const client = useQueryClient();
  const key = ["conversations", workspaceId];
  const list = useQuery({ queryKey: key, queryFn: () => api<Item[]>(`/api/w/${workspaceId}/conversations`) });
  const locale = useLocale();
  const [current, setCurrent] = useState<string | null>(null);
  const fields = useQuery({
    queryKey: ["fields", workspaceId],
    queryFn: () => api<FieldRow[]>(`/api/w/${workspaceId}/fields`),
  });
  const open = useQuery({
    queryKey: ["conversation", workspaceId, current],
    queryFn: () => api<{ messages: unknown[] }>(`/api/w/${workspaceId}/conversations/${current}`),
    enabled: Boolean(current),
  });
  const empty = Boolean(current) && open.data?.messages.length === 0;
  const [sendError, setSendError] = useState(false);
  async function suggest(text: string, fieldId?: string) {
    if (!current) return;
    setSendError(false);
    try {
      await api(`/api/w/${workspaceId}/conversations/${current}/messages`, {
        body: { text, context: fieldId ? { fieldId } : {}, lang: locale === "uk" ? "uk" : "en" },
      });
      void client.invalidateQueries({ queryKey: ["conversation", workspaceId, current] });
    } catch {
      setSendError(true);
    }
  }
  const suggestions = useMemo(() => {
    const f = fields.data ?? [];
    const out: Array<{ text: string; fieldId?: string }> = [{ text: app("aiSugg1") }];
    if (f[0]) out.push({ text: app("asSuggRisk", { name: f[0].name }), fieldId: f[0].id });
    if (f[1] ?? f[0]) {
      const x = (f[1] ?? f[0])!;
      out.push({ text: app("asSuggCrop", { name: x.name }), fieldId: x.id });
    }
    return out;
  }, [fields.data, app]);
  const groups = useMemo(() => {
    const today = new Date().toDateString();
    const all = list.data ?? [];
    return [
      { key: "asToday", rows: all.filter((c) => new Date(c.createdAt).toDateString() === today) },
      { key: "asEarlier", rows: all.filter((c) => new Date(c.createdAt).toDateString() !== today) },
    ].filter((g) => g.rows.length > 0);
  }, [list.data]);
  const hasContext = Boolean(context.fieldId || context.recommendationId);

  async function start() {
    const c = await api<{ id: string }>(`/api/w/${workspaceId}/conversations`, { body: {} });
    await client.invalidateQueries({ queryKey: key });
    setCurrent(c.id);
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
  async function remove(id: string) {
    await api(`/api/w/${workspaceId}/conversations/${id}`, { method: "DELETE" });
    if (current === id) setCurrent(null);
    void client.invalidateQueries({ queryKey: key });
  }

  useEffect(() => {
    if (current || !list.data) return;
    if (hasContext || list.data.length === 0) void start();
    else setCurrent(list.data[0]!.id);
  }, [list.data]);

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="order-2 flex flex-col gap-3 lg:order-1">
        <Button icon={<Plus />} onClick={() => void start()}>
          {t("new")}
        </Button>
        <h2 className="mt-2 font-mono text-small tracking-wide text-ink-2 uppercase">{t("hist")}</h2>
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
                    onClick={() => setCurrent(c.id)}
                    className="flex min-h-tap flex-1 items-center gap-2 text-left text-small text-ink"
                  >
                    <MessageSquare aria-hidden className="size-4 shrink-0 text-ink-3" strokeWidth={1.7} />
                    <span className={`line-clamp-2 ${current === c.id ? "font-semibold" : ""}`}>
                      {c.title ?? t("new")}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={app("aiDelete")}
                    onClick={() => void remove(c.id)}
                    className="text-ink-3 opacity-0 group-hover:opacity-100 focus:opacity-100"
                  >
                    <Trash2 className="size-4" strokeWidth={1.7} />
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
          <span className="inline-flex items-center gap-2 rounded-chip bg-muted px-3 py-1 text-small font-semibold text-ink">
            <ScanSearch aria-hidden className="size-4" strokeWidth={1.7} />
            {hasContext ? app("aiScopeContext") : app("aiScopeAll", { n: fieldCount })}
          </span>
        </div>
        {empty && (
          <div className="mb-3 flex flex-col gap-2">
            <p className="text-small text-ink-2">{app("asTry")}</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((x) => (
                <button
                  key={x.text}
                  type="button"
                  onClick={() => void suggest(x.text, x.fieldId)}
                  className="focus-ring inline-flex min-h-tap items-center gap-2 rounded-chip border border-line bg-surface-2 px-4 text-small font-semibold text-ink hover:bg-muted"
                >
                  <Sparkles aria-hidden className="size-4" strokeWidth={1.7} />
                  {x.text}
                </button>
              ))}
            </div>
            {sendError && (
              <p role="alert" className="text-small text-urgent">
                {app("errGeneric")}
              </p>
            )}
          </div>
        )}
        {current && (
          <Chat key={current} workspaceId={workspaceId} conversationId={current} context={context} />
        )}
      </section>
    </div>
  );
}
