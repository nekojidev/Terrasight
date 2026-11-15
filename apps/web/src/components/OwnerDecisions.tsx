"use client";

import type { Decision, DecisionAnswer, DecisionState } from "@terrasight/shared";
import { Button } from "@terrasight/ui";
import { Check, ChevronDown, Clock, MessageCircleQuestion } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

export type AnswerFn = (id: string, answer: DecisionAnswer, text?: string) => Promise<Decision | void>;

const OPEN: DecisionState[] = ["waiting", "question"];

/**
 * What the owner sees (v2.7): "N decisions need you", each a card with a thread and one-tap Approve / Not now / Ask…
 * `onAnswer={null}` is the read-only preview (staff "What the owner sees").
 */
export function OwnerDecisions({
  items,
  language: L,
  workspaceName,
  onAnswer,
}: {
  items: Decision[];
  language: "en" | "uk";
  workspaceName: string;
  onAnswer: AnswerFn | null;
}) {
  const t = useTranslations("App");
  // Server data is the base; answered cards are overridden locally (optimistic, then the API's Decision).
  const [local, setLocal] = useState<Record<string, Decision>>({});
  const [errors, setErrors] = useState<Record<string, { answer: DecisionAnswer; text?: string }>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [live, setLive] = useState("");
  const serverRef = useRef(items);
  useEffect(() => {
    // Fresh server data wins over stale local copies.
    if (serverRef.current !== items) {
      serverRef.current = items;
      setLocal({});
    }
  }, [items]);

  const merged = items.map((d) => local[d.id] ?? d);
  const needs = merged.filter((d) => OPEN.includes(d.state));
  const decided = merged.filter((d) => !OPEN.includes(d.state));
  const dayFmt = (iso: string) =>
    new Intl.DateTimeFormat(L === "uk" ? "uk-UA" : "en-US", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
    }).format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso));

  const send = async (d: Decision, answer: DecisionAnswer, text?: string) => {
    if (!onAnswer || busy[d.id]) return;
    const before = local[d.id];
    const now = new Date().toISOString();
    const optimistic: Decision = {
      ...d,
      state: answer === "approve" ? "approved" : answer === "not_now" ? "not_now" : "question",
      thread: [
        ...d.thread,
        {
          id: `tmp-${now}`,
          kind: "answer",
          author: { name: t("odYou"), role: "owner" },
          answer,
          text: text ?? null,
          at: now,
        },
      ],
    };
    setBusy((b) => ({ ...b, [d.id]: true }));
    setErrors((e) => {
      const rest = { ...e };
      delete rest[d.id];
      return rest;
    });
    setLocal((l) => ({ ...l, [d.id]: optimistic }));
    try {
      const saved = await onAnswer(d.id, answer, text);
      if (saved) setLocal((l) => ({ ...l, [d.id]: saved }));
      setLive(
        answer === "approve" ? t("odLiveApproved") : answer === "not_now" ? t("odLiveNotNow") : t("odLiveAsked"),
      );
    } catch {
      setLocal((l) => {
        const rest = { ...l };
        delete rest[d.id];
        return before ? { ...rest, [d.id]: before } : rest;
      });
      setErrors((e) => ({ ...e, [d.id]: { answer, ...(text !== undefined ? { text } : {}) } }));
    } finally {
      setBusy((b) => ({ ...b, [d.id]: false }));
    }
  };

  const card = (d: Decision) => (
    <DecisionCard
      key={d.id}
      d={d}
      L={L}
      day={dayFmt}
      readOnly={!onAnswer}
      busy={!!busy[d.id]}
      failed={errors[d.id] ?? null}
      onSend={(a, text) => void send(d, a, text)}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="text-small text-ink-2">
          {t("odFrom")} · {workspaceName}
        </p>
        <h1 className="text-h1 text-ink">
          {needs.length > 0 ? t("odNeedYou", { n: needs.length }) : t("odNothing")}
        </h1>
        {needs.length === 0 && decided.length === 0 && (
          <p className="mt-1 text-body text-ink-2">{t("odEmpty")}</p>
        )}
      </header>
      <p role="status" aria-live="polite" className="sr-only">
        {live}
      </p>
      {needs.length > 0 && (
        <section aria-labelledby="od-needs" className="flex flex-col gap-3">
          <h2 id="od-needs" className="text-h3 text-ink">
            {t("odSecNeeds")}
          </h2>
          {needs.map(card)}
        </section>
      )}
      {decided.length > 0 && (
        <details className="group">
          <summary className="focus-ring flex min-h-tap cursor-pointer list-none items-center justify-between gap-2 rounded-btn text-h3 text-ink">
            {t("odSecDecided", { n: decided.length })}
            <ChevronDown aria-hidden className="size-5 text-ink-2 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3 flex flex-col gap-3">{decided.map(card)}</div>
        </details>
      )}
      <p className="text-micro text-ink-3">{t("rpFoot")}</p>
    </div>
  );
}

function DecisionCard({
  d,
  L,
  day,
  readOnly,
  busy,
  failed,
  onSend,
}: {
  d: Decision;
  L: "en" | "uk";
  day: (iso: string) => string;
  readOnly: boolean;
  busy: boolean;
  failed: { answer: DecisionAnswer; text?: string } | null;
  onSend: (a: DecisionAnswer, text?: string) => void;
}) {
  const t = useTranslations("App");
  const [asking, setAsking] = useState(false);
  const [changing, setChanging] = useState(false);
  const [question, setQuestion] = useState("");
  const open = OPEN.includes(d.state);
  const note = d.thread.find((e) => e.kind === "note" && e.text);
  const overdue = d.deadline !== null && d.deadline < new Date().toISOString().slice(0, 10);
  const lastAnswer = [...d.thread].reverse().find((e) => e.kind === "answer");
  const numbers = d.keyNumbers.slice(0, 3).map((k) => {
    const v =
      typeof k.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k.value)
        ? day(k.value)
        : `${k.value}${k.unit && k.unit !== "seasons" ? ` ${k.unit}` : ""}`;
    return { id: k.id, value: v, label: t.has(`kn_${k.id}`) ? t(`kn_${k.id}`) : k.id };
  });
  const showButtons = !readOnly && (open || changing);
  const date = lastAnswer ? day(lastAnswer.at) : "";
  const stateLine =
    d.state === "approved"
      ? t("odYouApproved", { date })
      : d.state === "not_now"
        ? t("odYouNotNow", { date })
        : d.state === "question"
          ? t("odYouAsked")
          : null;
  const pick = (a: DecisionAnswer) => {
    if (a === "question") {
      setAsking(true);
      return;
    }
    setChanging(false);
    onSend(a);
  };
  const thread = d.thread.filter((e) => e.kind !== "note");

  return (
    <article className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-small font-semibold text-ink">{d.fieldName}</p>
        {d.deadline && open && (
          <span
            className={`flex items-center gap-1 rounded-chip px-2.5 py-1 text-small font-semibold ${overdue ? "bg-urgent-soft text-urgent" : "bg-week-soft text-week"}`}
          >
            <Clock aria-hidden className="size-3.5" />
            {overdue ? `${t("rpOverdue")} · ${day(d.deadline)}` : t("rpDeadline", { date: day(d.deadline) })}
          </span>
        )}
      </div>
      <h3 className="text-[18px] leading-6 font-semibold text-ink">{d.title[L]}</h3>
      {note && (
        <blockquote className="border-l-2 border-line-strong pl-3 text-body text-ink">
          <span className="font-semibold">{note.author.name}: </span>
          {note.text}
        </blockquote>
      )}
      <p className="text-body text-ink-2">{d.action[L]}</p>
      {numbers.length > 0 && (
        <dl className="grid grid-cols-3 gap-2">
          {numbers.map((n) => (
            <div key={n.id} className="flex min-w-0 flex-col rounded-input bg-surface-2 p-2">
              <dd className="text-body font-semibold text-ink">{n.value}</dd>
              <dt className="text-micro text-ink-3">{n.label}</dt>
            </div>
          ))}
        </dl>
      )}
      <p className="text-small text-ink-2">
        <span className="font-semibold text-ink">{t("rpWhy")}: </span>
        {d.why[L]}
      </p>
      {thread.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={t("odThread")}>
          {thread.map((e) => {
            const mine = e.author.role === "owner";
            return (
              <li key={e.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                <div
                  className={`max-w-[85%] rounded-card px-3 py-2 text-small ${mine ? "bg-ink text-surface" : "bg-surface-2 text-ink"}`}
                >
                  {e.kind === "answer" && e.answer && (
                    <span className="font-semibold">
                      {t(`odAns_${e.answer}`)}
                      {e.text ? ": " : ""}
                    </span>
                  )}
                  {e.text}
                </div>
                <span className="mt-0.5 text-micro text-ink-3">
                  {mine ? t("odYou") : e.author.name} · {day(e.at)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {stateLine && (
        <p
          role="status"
          aria-live="polite"
          className={`text-small font-semibold ${d.state === "question" ? "text-ink-2" : "text-ok"}`}
        >
          {stateLine}
        </p>
      )}
      {failed && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-input bg-urgent-soft p-3 text-small text-urgent"
        >
          {t("odError")}
          <Button variant="outline" onClick={() => onSend(failed.answer, failed.text)}>
            {t("odRetry")}
          </Button>
        </div>
      )}
      {!readOnly && !open && !changing && (
        <Button variant="link" className="min-h-tap self-start" onClick={() => setChanging(true)}>
          {t("odChange")}
        </Button>
      )}
      {showButtons && (
        <div className="grid grid-cols-3 gap-2">
          {(["approve", "not_now", "question"] as const).map((a) => (
            <button
              key={a}
              type="button"
              disabled={busy}
              onClick={() => pick(a)}
              className={`focus-ring flex min-h-14 flex-col items-center justify-center gap-1 rounded-btn border px-1 text-small font-semibold disabled:opacity-40 ${
                a === "approve" ? "border-ink bg-ink text-surface" : "border-line-strong bg-surface text-ink"
              }`}
            >
              {a === "approve" ? (
                <Check aria-hidden className="size-5" />
              ) : a === "not_now" ? (
                <Clock aria-hidden className="size-5" />
              ) : (
                <MessageCircleQuestion aria-hidden className="size-5" />
              )}
              {t(`odBtn_${a}`)}
            </button>
          ))}
        </div>
      )}
      {showButtons && asking && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!question.trim()) return;
            onSend("question", question.trim());
            setAsking(false);
            setChanging(false);
            setQuestion("");
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor={`q-${d.id}`} className="text-small font-semibold text-ink">
            {t("rpAskLabel")}
          </label>
          <textarea
            id={`q-${d.id}`}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={1000}
            className="min-h-20 rounded-input border border-line-strong bg-surface p-3 text-body"
          />
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => setAsking(false)}>
              {t("rpCancel")}
            </Button>
            <Button type="submit" disabled={!question.trim() || busy}>
              {t("rpSendQuestion")}
            </Button>
          </div>
        </form>
      )}
    </article>
  );
}
