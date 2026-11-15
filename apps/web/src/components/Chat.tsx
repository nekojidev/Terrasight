"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@terrasight/ui";
import { ArrowDown, RotateCcw, Send, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { QueryState } from "@/components/QueryState";
import { displayText, restoreAliases } from "@/lib/assistant-text";
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

/** Within this many pixels of the bottom the thread follows new messages; further up it stays where the user is. */
const STICK_PX = 80;

/** A plain table of a tool result for the fallback card (S-05.03). */
function ResultTable({
  result,
  aliases,
  lang,
}: {
  result: unknown;
  aliases: Conversation["aliases"];
  lang: "en" | "uk";
}) {
  const rows: Array<[string, string]> = [];
  const walk = (node: unknown, path: string) => {
    if (rows.length > 30 || node === null || node === undefined) return;
    if (typeof node !== "object") return rows.push([path, displayText(String(node), aliases, lang)]);
    const o = node as Record<string, unknown>;
    if (typeof o.value === "number" && "unit" in o) return rows.push([path, `${o.value} ${String(o.unit)}`]);
    for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(result, "");
  return (
    // Wide tables scroll inside the card instead of pushing the page sideways on phones.
    <div className="max-w-full overflow-x-auto">
      <table className="w-full min-w-[260px] text-small">
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={`${i}:${k}`} className="border-b border-line last:border-0">
              <th className="py-1 pr-3 text-left font-normal break-words text-ink-2">{k}</th>
              <td className="py-1 text-right font-mono break-words text-ink">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Conversation with the assistant (design 14): checked sentences stream in, progress shows while tools run. */
export function Chat({
  workspaceId,
  conversationId,
  context,
  compact = false,
  suggestions,
  onMissing,
  autoFocus = false,
}: {
  workspaceId: string;
  conversationId: string;
  context?: { fieldId?: string; recommendationId?: string };
  compact?: boolean;
  /** Chips under the thread; defaults to the general ones. */
  suggestions?: string[];
  /** The conversation no longer exists (deleted or expired): the owner of the id forgets it. */
  onMissing?: () => void;
  autoFocus?: boolean;
}) {
  const t = useTranslations("App");
  const a = useTranslations("Assistant");
  const client = useQueryClient();
  const locale = useLocale();
  const lang = locale === "uk" ? "uk" : "en";
  const key = ["conversation", workspaceId, conversationId];
  const conv = useQuery({
    queryKey: key,
    queryFn: () => api<Conversation>(`/api/w/${workspaceId}/conversations/${conversationId}`),
    // Coming back to a page: the cached thread shows at once, but is always re-read (an answer may have finished).
    refetchOnMount: "always",
    retry: (n, e) => !(e instanceof ApiError && e.problem.status === 404) && n < 2,
    refetchInterval: (q) => {
      const last = q.state.data?.messages.at(-1);
      return last?.role === "assistant" && !last.text && !last.error ? 2_000 : false;
    },
  });
  const [progress, setProgress] = useState<string | null>(null);
  const [live, setLive] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);

  const missing = conv.error instanceof ApiError && conv.error.problem.status === 404;
  useEffect(() => {
    if (missing) onMissing?.();
  }, [missing, onMissing]);

  // Subscribe to this conversation; when we come back mid-answer the snapshot and the refetch above catch up.
  useEffect(() => {
    setLive([]);
    setProgress(null);
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
        } else {
          if (env.type === "assistant.done") {
            setProgress(null);
            setLive([]);
          }
          void client.invalidateQueries({ queryKey: ["conversation", workspaceId, conversationId] });
        }
      },
    });
    return () => ctl.stop();
  }, [workspaceId, conversationId, client]);

  const messages = conv.data?.messages ?? [];
  const last = messages.at(-1);
  const pending = last?.role === "assistant" && !last.text && !last.error;
  const busy = sending || pending;

  const toEnd = useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    else el.scrollTop = el.scrollHeight;
  }, []);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    if (stick.current) setAway(false);
  };
  // New content: follow it only while the user is at the bottom; otherwise offer a "Jump to latest" button.
  useLayoutEffect(() => {
    if (stick.current) toEnd();
    else setAway(true);
  }, [messages.length, last?.text, live.length, progress, toEnd]);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus, conversationId]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setError(null);
    setText("");
    setSending(true);
    stick.current = true;
    try {
      await api(`/api/w/${workspaceId}/conversations/${conversationId}/messages`, {
        body: { text: question, context: context ?? {}, lang },
      });
      await client.invalidateQueries({ queryKey: key });
      // The titles in the history list come from the first question.
      void client.invalidateQueries({ queryKey: ["conversations", workspaceId] });
    } catch (e) {
      setText(question);
      setError(e instanceof ApiError && e.problem.status === 429 ? t("aiRateLimited") : t("errGeneric"));
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(text);
  };
  // Enter sends, Shift+Enter adds a line; Enter while an IME composes a character does neither.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void ask(text);
    }
  };
  // The question before the failed answer, to send again.
  const retryText = (i: number): string | null => {
    for (let j = i - 1; j >= 0; j--) if (messages[j]!.role === "user") return messages[j]!.text;
    return null;
  };

  const aliases = conv.data?.aliases ?? {};
  const show = (s: string) => displayText(s, aliases, lang);
  const chips = suggestions ?? [t("aiSugg1"), t("aiSugg2"), t("aiSugg3")];
  return (
    <div className={`flex min-h-0 flex-col ${compact ? "h-[min(560px,70dvh)]" : "h-[calc(100dvh-220px)]"}`}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scroller}
          onScroll={onScroll}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-busy={busy}
          className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-1"
        >
          {!conv.data && !missing && <QueryState query={conv}>{() => null}</QueryState>}
          {missing && (
            <p role="alert" className="text-body text-ink-2">
              {t("errGeneric")}
            </p>
          )}
          {conv.data && messages.length === 0 && <p className="text-body text-ink-2">{t("aiEmpty")}</p>}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <p
                key={m.id}
                className="max-w-[85%] self-end rounded-card bg-ink px-4 py-3 text-body break-words whitespace-pre-wrap text-surface"
              >
                {restoreAliases(m.text, aliases)}
              </p>
            ) : (
              <div key={m.id} className="flex max-w-[95%] min-w-0 flex-col gap-2">
                {m.error ? (
                  <div className="flex flex-col items-start gap-2">
                    <p className="flex items-center gap-2 text-body text-urgent">
                      <TriangleAlert aria-hidden className="size-4 shrink-0" />
                      {t("aiUnavailable")}
                    </p>
                    {retryText(i) && (
                      <Button
                        variant="outline"
                        icon={<RotateCcw />}
                        disabled={busy}
                        onClick={() => void ask(retryText(i)!)}
                      >
                        {t("aiRetry")}
                      </Button>
                    )}
                  </div>
                ) : m.text ? (
                  <p className="text-body break-words whitespace-pre-wrap text-ink">{show(m.text)}</p>
                ) : (
                  <p className="text-body break-words text-ink">
                    {live.length ? (
                      show(live.join(" "))
                    ) : (
                      <span className="text-ink-2">{progress ?? t("aiThinking")}</span>
                    )}
                  </p>
                )}
                {m.fallback && m.card && (
                  <div className="min-w-0 rounded-card border border-line bg-surface-2 p-4">
                    <p className="mb-2 text-small text-week">{t("aiFallback")}</p>
                    {m.card.map((c, ci) => (
                      <div key={ci} className="mb-3 min-w-0">
                        <p className="mb-1 font-mono text-micro break-words text-ink-2">{t("aiTool", { tool: c.tool })}</p>
                        <ResultTable result={c.result} aliases={aliases} lang={lang} />
                      </div>
                    ))}
                  </div>
                )}
                {m.checked && m.text && !m.fallback && m.numbersChecked > 0 && (
                  <p className="flex w-fit items-center gap-1.5 rounded-chip bg-ok-soft px-3 py-1 text-small text-ok">
                    <ShieldCheck aria-hidden className="size-4" strokeWidth={1.7} />
                    {t("aiNumbers", { n: m.numbersChecked })}
                  </p>
                )}
              </div>
            ),
          )}
        </div>
        {away && (
          <button
            type="button"
            onClick={() => {
              stick.current = true;
              setAway(false);
              toEnd(true);
            }}
            className="focus-ring absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-chip border border-line-strong bg-surface px-3 py-1.5 text-small font-semibold text-ink shadow-sheet"
          >
            <ArrowDown aria-hidden className="size-4" strokeWidth={1.7} />
            {t("aiJumpLatest")}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2 py-3">
        {chips.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => void ask(s)}
            className="focus-ring flex max-w-full items-center gap-1.5 rounded-chip bg-muted px-3 py-1.5 text-left text-small font-semibold text-ink hover:bg-line disabled:opacity-60"
          >
            <Sparkles aria-hidden className="size-3.5 shrink-0" strokeWidth={1.7} />
            <span className="min-w-0 break-words">{s}</span>
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
        className="flex items-end gap-2 rounded-input border border-line-strong bg-surface p-2"
      >
        <textarea
          ref={input}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={sending}
          aria-label={a("ph")}
          placeholder={a("ph")}
          maxLength={2000}
          className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-body text-ink outline-none placeholder:text-ink-3 disabled:opacity-60 [field-sizing:content]"
        />
        <Button
          type="submit"
          variant="icon"
          label={a("send")}
          icon={<Send />}
          disabled={busy || !text.trim()}
          aria-busy={sending}
        />
      </form>
      <p className="mt-2 text-small text-ink-3">{a("disclaimer")}</p>
    </div>
  );
}
