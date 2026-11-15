"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Kicker, Surface } from "@terrasight/ui";
import { ArrowDown, RotateCcw, Send, ShieldAlert, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { QueryState } from "@/components/QueryState";
import { displayText, restoreAliases } from "@/lib/assistant-text";
import { ToolCard } from "@/components/ToolCard";
import { connectStream } from "@/lib/events";
import { useActionToast } from "@/lib/useActionToast";

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

/** Three dots while an answer is written; they pulse only when motion is allowed. */
function Typing({ label }: { label: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-caption text-ink-2">
      <span aria-hidden className="inline-flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 rounded-full bg-ink-3 motion-safe:animate-pulse" style={{ animationDelay: `${i * 160}ms` }} />
        ))}
      </span>
      {label}
    </span>
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
  const { fail } = useActionToast();
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
      fail(
        e instanceof ApiError && e.problem.status === 429 ? new Error(t("aiRateLimited")) : e,
        a("sendFail"),
        () => void ask(question),
      );
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
    <div
      className={`flex min-h-0 flex-col ${compact ? "h-[min(560px,70dvh)]" : "h-[max(360px,calc(100dvh-var(--ts-tabbar)-200px))] lg:h-[calc(100dvh-220px)]"}`}
    >
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
                className="animate-rise max-w-[85%] self-end rounded-card bg-ink px-4 py-3 text-body break-words whitespace-pre-wrap text-surface"
              >
                {restoreAliases(m.text, aliases)}
              </p>
            ) : (
              <div key={m.id} className="animate-rise flex max-w-[95%] min-w-0 flex-col gap-2">
                {m.error ? (
                  <Surface as="div" tone="inset" pad="sm" role="alert" className="flex flex-col items-start gap-2">
                    <p className="flex items-center gap-2 text-body font-semibold text-urgent">
                      <TriangleAlert aria-hidden className="size-5 shrink-0" strokeWidth={1.7} />
                      {a("unavailTitle")}
                    </p>
                    <p className="text-small text-ink-2">{a("unavailBody")}</p>
                    {retryText(i) && (
                      <Button
                        variant="outline"
                        icon={<RotateCcw />}
                        disabled={busy}
                        onClick={() => void ask(retryText(i)!)}
                      >
                        {t("retry")}
                      </Button>
                    )}
                  </Surface>
                ) : m.text ? (
                  <p className="text-body break-words whitespace-pre-wrap text-ink">{show(m.text)}</p>
                ) : (
                  <div className="flex flex-col gap-2 text-body break-words text-ink">
                    {live.length > 0 && <p className="whitespace-pre-wrap">{show(live.join(" "))}</p>}
                    <Typing label={progress ?? a("typing")} />
                  </div>
                )}
                {m.fallback && m.card && (
                  <div className="flex min-w-0 flex-col gap-3">
                    <p className="flex items-start gap-2 text-small text-week">
                      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.7} />
                      {t("aiFallback")}
                    </p>
                    {m.card.map((c, ci) => (
                      <ToolCard key={ci} tool={c.tool} result={c.result} aliases={aliases} lang={lang} />
                    ))}
                  </div>
                )}
                {m.text && !m.fallback && (
                  <p
                    className={`flex w-fit items-center gap-1.5 rounded-chip px-3 py-1 text-caption ${m.checked ? "bg-ok-soft text-ok" : "bg-week-soft text-week"}`}
                  >
                    {m.checked ? (
                      <ShieldCheck aria-hidden className="size-4" strokeWidth={1.7} />
                    ) : (
                      <ShieldAlert aria-hidden className="size-4" strokeWidth={1.7} />
                    )}
                    {m.checked ? t("aiNumbers", { n: m.numbersChecked }) : a("notChecked")}
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
      {chips.length > 0 && (
        <div className="flex flex-col gap-2 py-3">
          <Kicker>{a("ask")}</Kicker>
          <div className="flex flex-wrap gap-2">
            {chips.slice(0, 4).map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => void ask(s)}
                className="focus-ring flex min-h-tap max-w-full items-center gap-1.5 rounded-chip bg-muted px-3 py-1.5 text-left text-caption font-semibold text-ink hover:bg-line disabled:opacity-60"
              >
                <Sparkles aria-hidden className="size-3.5 shrink-0" strokeWidth={1.7} />
                <span className="min-w-0 break-words">{s}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <form
        onSubmit={submit}
        className="sticky bottom-[calc(var(--ts-tabbar)+env(safe-area-inset-bottom))] z-10 flex items-end gap-2 rounded-input border border-line-control bg-surface p-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink lg:bottom-0"
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
          className="size-12!"
          disabled={busy || !text.trim()}
          aria-busy={sending}
        />
      </form>
      <p className="mt-2 text-caption text-ink-3">{a("disclaimer")}</p>
    </div>
  );
}
