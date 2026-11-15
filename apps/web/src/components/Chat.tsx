"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Kicker, Surface } from "@terrasight/ui";
import { ArrowDown, ArrowRight, ChevronDown, RotateCcw, Send, ShieldAlert, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { QueryState } from "@/components/QueryState";
import { evidenceLink } from "@/lib/assistant-context";
import { answerLang, displayText, restoreAliases, type Aliases } from "@/lib/assistant-text";
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
  tools: Array<{ tool: string; args?: unknown; result?: unknown }>;
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

/**
 * The tool results behind one answer, read only when the user opens "Show the numbers" (they can be large, so the
 * thread itself does not carry them). Three rows per card; the rest behind "All rows".
 */
function Evidence({
  workspaceId,
  conversationId,
  message,
  aliases,
  lang,
}: {
  workspaceId: string;
  conversationId: string;
  message: Message;
  aliases: Aliases;
  lang: "en" | "uk";
}) {
  const a = useTranslations("Assistant");
  const withCard = message.card && message.card.length > 0;
  const q = useQuery({
    queryKey: ["conversation-tools", workspaceId, conversationId, message.id],
    queryFn: () => api<Conversation>(`/api/w/${workspaceId}/conversations/${conversationId}?include=tools`),
    enabled: !withCard,
    staleTime: 60_000,
  });
  const cards: Array<{ tool: string; result: unknown }> =
    (withCard ? message.card : null) ??
    (q.data?.messages
      .find((m) => m.id === message.id)
      ?.tools.filter((t) => t.result && !(typeof t.result === "object" && "error" in (t.result as object)))
      .map((t) => ({ tool: t.tool, result: t.result })) ??
      []);
  return (
    <section aria-label={a("evidenceTitle")} className="flex min-w-0 flex-col gap-3">
      {!withCard && q.isPending && <p className="text-caption text-ink-2">{a("evidenceLoading")}</p>}
      {!withCard && !q.isPending && cards.length === 0 && <p className="text-caption text-ink-2">{a("evidenceNone")}</p>}
      {cards.map((c, ci) => (
        <ToolCard key={ci} tool={c.tool} result={c.result} aliases={aliases} lang={lang} answer={message.text} />
      ))}
    </section>
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
  placeholder,
  prefill,
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
  /** The composer's hint; defaults to the company-wide one. A field panel passes "Ask about {field}…". */
  placeholder?: string;
  /** A prepared question: placed in the composer and focused, never sent. A new `nonce` places it again. */
  prefill?: { text: string; nonce: number } | null;
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

  // A prepared question ("Ask why", a suggestion, an Ask link): visible in the composer, the user presses Send.
  const placed = useRef<number | null>(null);
  useEffect(() => {
    if (!prefill || placed.current === prefill.nonce) return;
    placed.current = prefill.nonce;
    setText(prefill.text);
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [prefill]);
  const prepare = (q: string) => {
    setText(q);
    input.current?.focus();
  };
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });

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
  const chips = suggestions ?? [a("sugg.all1"), a("sugg.all2"), a("sugg.all3")];
  const empty = Boolean(conv.data) && messages.length === 0;
  const hint = placeholder ?? a("ph");
  return (
    <div
      className={`flex min-h-0 flex-col ${compact ? "max-h-[min(560px,70dvh)]" : "h-[max(360px,calc(100dvh-var(--ts-tabbar)-200px))] lg:h-[calc(100dvh-220px)]"}`}
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
          {empty && (
            <div className="flex flex-col gap-3">
              <Kicker>{a("ask")}</Kicker>
              <div className="flex flex-col items-start gap-2">
                {chips.slice(0, 3).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => prepare(s)}
                    className="focus-ring flex min-h-tap max-w-full items-center gap-2 rounded-chip bg-muted px-4 py-2 text-left text-small font-semibold text-ink hover:bg-line"
                  >
                    <Sparkles aria-hidden className="size-4 shrink-0" strokeWidth={1.7} />
                    <span className="min-w-0 break-words">{s}</span>
                  </button>
                ))}
              </div>
              <p className="text-caption text-ink-2">{a("canDo")}</p>
            </div>
          )}
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
                  <>
                    {/* Dates inside an answer follow the answer's own language; the card and chrome follow the interface. */}
                    <p className="text-body break-words whitespace-pre-wrap text-ink">
                      {displayText(m.text, aliases, answerLang(m.text) ?? lang)}
                    </p>
                    {answerLang(m.text) && answerLang(m.text) !== lang && (
                      <p className="text-caption text-ink-3">{answerLang(m.text) === "en" ? a("answeredEn") : a("answeredUk")}</p>
                    )}
                  </>
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
                      <ToolCard key={ci} tool={c.tool} result={c.result} aliases={aliases} lang={lang} answer={m.text} />
                    ))}
                  </div>
                )}
                {m.text && !m.fallback && !m.checked && (
                  <p className="flex w-fit items-center gap-1.5 rounded-chip bg-week-soft px-3 py-1 text-caption text-week">
                    <ShieldAlert aria-hidden className="size-4" strokeWidth={1.7} />
                    {a("notChecked")}
                  </p>
                )}
                {m.text && !m.fallback && m.checked && m.numbersChecked === 0 && (
                  <p className="flex w-fit items-center gap-1.5 rounded-chip bg-ok-soft px-3 py-1 text-caption text-ok">
                    <ShieldCheck aria-hidden className="size-4" strokeWidth={1.7} />
                    {t("aiNumbers", { n: 0 })}
                  </p>
                )}
                {m.text && !m.fallback && m.checked && m.numbersChecked > 0 && (
                  <>
                    <button
                      type="button"
                      aria-expanded={open.has(m.id)}
                      onClick={() => toggle(m.id)}
                      className="focus-ring flex min-h-tap w-fit items-center gap-1.5 rounded-chip bg-ok-soft px-3 py-1 text-left text-caption text-ok"
                    >
                      <ShieldCheck aria-hidden className="size-4 shrink-0" strokeWidth={1.7} />
                      <span>{t("aiNumbers", { n: m.numbersChecked })}</span>
                      <span aria-hidden>·</span>
                      <span className="font-semibold underline">{open.has(m.id) ? a("hideEvidence") : a("showEvidence")}</span>
                      <ChevronDown
                        aria-hidden
                        className={`size-4 shrink-0 ${open.has(m.id) ? "rotate-180" : ""}`}
                        strokeWidth={1.7}
                      />
                    </button>
                    {open.has(m.id) && (
                      <Evidence workspaceId={workspaceId} conversationId={conversationId} message={m} aliases={aliases} lang={lang} />
                    )}
                  </>
                )}
                {m.text && !m.error && (() => {
                  const link = evidenceLink(m.tools, aliases);
                  if (!link) return null;
                  return (
                    <Link
                      href={link.href}
                      className="focus-ring inline-flex min-h-tap w-fit items-center gap-1.5 text-small font-semibold text-ink underline"
                    >
                      {link.kind === "recommendation" ? a("openRec") : link.kind === "rotation" ? a("openRotation") : a("openField")}
                      <ArrowRight aria-hidden className="size-4" strokeWidth={1.7} />
                    </Link>
                  );
                })()}
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
      {chips.length > 0 && !empty && (
        <div className="flex flex-col gap-2 py-3">
          <Kicker>{a("ask")}</Kicker>
          <div className="flex flex-wrap gap-2">
            {chips.slice(0, 4).map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => prepare(s)}
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
          aria-label={hint}
          placeholder={hint}
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
