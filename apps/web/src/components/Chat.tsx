"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@terrasight/ui";
import { Send, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { connectStream } from "@/lib/events";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  checked: boolean;
  fallback: boolean;
  numbersChecked: number;
  card: Array<{ tool: string; result: unknown }> | null;
  error: string | null;
  tools: Array<{ tool: string }>;
}
interface Conversation {
  id: string;
  aliases: Record<string, { id: string; name: string }>;
  messages: Message[];
}

/** Field aliases (F3) back to the company's field names, only in the browser (RFC §12.6). */
function restore(text: string, aliases: Conversation["aliases"]): string {
  return text.replace(/\bF(\d+)\b/g, (m) => aliases[m]?.name ?? m);
}

/** A plain table of a tool result for the fallback card (S-05.03). */
function ResultTable({ result, aliases }: { result: unknown; aliases: Conversation["aliases"] }) {
  const rows: Array<[string, string]> = [];
  const walk = (node: unknown, path: string) => {
    if (rows.length > 30 || node === null || node === undefined) return;
    if (typeof node !== "object") return rows.push([path, restore(String(node), aliases)]);
    const o = node as Record<string, unknown>;
    if (typeof o.value === "number" && "unit" in o) return rows.push([path, `${o.value} ${String(o.unit)}`]);
    for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(result, "");
  return (
    <table className="w-full text-small">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b border-line last:border-0">
            <th className="py-1 pr-3 text-left font-normal text-ink-2">{k}</th>
            <td className="py-1 text-right font-mono text-ink">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Conversation with the assistant (design 14): checked sentences stream in, progress shows while tools run. */
export function Chat({
  workspaceId,
  conversationId,
  context,
  compact = false,
}: {
  workspaceId: string;
  conversationId: string;
  context?: { fieldId?: string; recommendationId?: string };
  compact?: boolean;
}) {
  const t = useTranslations("App");
  const a = useTranslations("Assistant");
  const client = useQueryClient();
  const locale = useLocale();
  const key = ["conversation", workspaceId, conversationId];
  const conv = useQuery({
    queryKey: key,
    queryFn: () => api<Conversation>(`/api/w/${workspaceId}/conversations/${conversationId}`),
    refetchInterval: (q) =>
      q.state.data?.messages.at(-1)?.role === "assistant" &&
      !q.state.data.messages.at(-1)!.text &&
      !q.state.data.messages.at(-1)!.error
        ? 2_000
        : false,
  });
  const [progress, setProgress] = useState<string | null>(null);
  const [live, setLive] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctl = connectStream({
      workspaceId,
      topics: [`conversation:${conversationId}`],
      invalidate: () => undefined,
      onEvent: (_topic, raw) => {
        const env = raw as { type?: string; data?: { text?: string } };
        if (env.type === "assistant.progress") setProgress(env.data?.text ?? null);
        else if (env.type === "assistant.sentence") {
          setProgress(null);
          setLive((l) => [...l, env.data?.text ?? ""]);
        } else if (env.type === "assistant.done") {
          setProgress(null);
          setLive([]);
          void client.invalidateQueries({ queryKey: key });
        }
      },
    });
    return () => ctl.stop();
  }, [workspaceId, conversationId, client]);

  useEffect(
    () => end.current?.scrollIntoView({ block: "end" }),
    [conv.data?.messages.length, live.length, progress],
  );

  async function ask(q: string) {
    if (!q.trim()) return;
    setError(null);
    setText("");
    try {
      await api(`/api/w/${workspaceId}/conversations/${conversationId}/messages`, {
        body: { text: q, context: context ?? {}, lang: locale === "uk" ? "uk" : "en" },
      });
      void client.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(e instanceof ApiError && e.problem.status === 429 ? t("aiRateLimited") : t("errGeneric"));
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(text);
  };

  const aliases = conv.data?.aliases ?? {};
  const messages = conv.data?.messages ?? [];
  return (
    <div className={`flex min-h-0 flex-col ${compact ? "h-[560px]" : "h-[calc(100vh-220px)]"}`}>
      <div aria-live="polite" className="flex flex-1 flex-col gap-4 overflow-y-auto p-1">
        {messages.length === 0 && <p className="text-body text-ink-2">{t("aiEmpty")}</p>}
        {messages.map((m) =>
          m.role === "user" ? (
            <p
              key={m.id}
              className="max-w-[85%] self-end rounded-card bg-ink px-4 py-3 text-body text-surface"
            >
              {restore(m.text, aliases)}
            </p>
          ) : (
            <div key={m.id} className="flex max-w-[95%] flex-col gap-2">
              {m.error ? (
                <p className="flex items-center gap-2 text-body text-urgent">
                  <TriangleAlert aria-hidden className="size-4" />
                  {t("aiUnavailable")}
                </p>
              ) : m.text ? (
                <p className="text-body text-ink">{restore(m.text, aliases)}</p>
              ) : (
                <p className="text-body text-ink">
                  {live.length ? (
                    restore(live.join(" "), aliases)
                  ) : (
                    <span className="text-ink-2">{progress ?? t("aiThinking")}</span>
                  )}
                </p>
              )}
              {m.fallback && m.card && (
                <div className="rounded-card border border-line bg-surface-2 p-4">
                  <p className="mb-2 text-small text-week">{t("aiFallback")}</p>
                  {m.card.map((c, i) => (
                    <div key={i} className="mb-3">
                      <p className="mb-1 font-mono text-micro text-ink-2">{t("aiTool", { tool: c.tool })}</p>
                      <ResultTable result={c.result} aliases={aliases} />
                    </div>
                  ))}
                </div>
              )}
              {m.checked && m.text && (
                <p className="flex w-fit items-center gap-1.5 rounded-chip bg-ok-soft px-3 py-1 text-small text-ok">
                  <ShieldCheck aria-hidden className="size-4" strokeWidth={1.7} />
                  {t("aiNumbers", { n: m.numbersChecked })}
                </p>
              )}
            </div>
          ),
        )}
        <div ref={end} />
      </div>
      <div className="flex flex-wrap gap-2 py-3">
        {[t("aiSugg1"), t("aiSugg2"), t("aiSugg3")].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => void ask(s)}
            className="focus-ring flex items-center gap-1.5 rounded-chip bg-muted px-3 py-1.5 text-small font-semibold text-ink hover:bg-line"
          >
            <Sparkles aria-hidden className="size-3.5" strokeWidth={1.7} />
            {s}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mb-2 text-small text-urgent">
          {error}
        </p>
      )}
      <form
        onSubmit={submit}
        className="flex items-center gap-2 rounded-input border border-line-strong bg-surface p-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={a("ph")}
          placeholder={a("ph")}
          maxLength={2000}
          className="min-h-11 flex-1 bg-transparent px-2 text-body text-ink outline-none placeholder:text-ink-3"
        />
        <Button type="submit" variant="icon" label={a("send")} icon={<Send />} />
      </form>
      <p className="mt-2 text-micro text-ink-3">{a("disclaimer")}</p>
    </div>
  );
}
