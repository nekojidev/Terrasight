"use client";

import type { Decision, DecisionAnswer, DecisionState } from "@terrasight/shared";
import { Button, Disclosure, Kicker, Surface } from "@terrasight/ui";
import { Check, Clock, MessageCircleQuestion, Pause } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { keyNumberViews, splitOwnerNumbers } from "@/app/decisions/key-numbers";
import { useFormat } from "@/lib/useFormat";
import { useActionToast } from "@/lib/useActionToast";

export type AnswerFn = (id: string, answer: DecisionAnswer, text?: string) => Promise<Decision | void>;

const OPEN: DecisionState[] = ["waiting", "question"];
const ANSWER_ICON = {
  approve: <Check />,
  not_now: <Pause />,
  question: <MessageCircleQuestion />,
} as const;

/**
 * What the owner sees: the decisions the agronomist asked about, waiting ones first, each with the plain question,
 * up to three key numbers and answer buttons (Approve / Not now / Ask a question).
 * Used on the Owner's Decisions page, on the public link, and read-only (`onAnswer={null}`) as the agronomist's preview.
 */
export function OwnerDecisions({
  items,
  language: L,
  workspaceName,
  onAnswer,
  standalone = false,
}: {
  items: Decision[];
  /** Language of the card text: the interface language when signed in, the link's language on the no-account page. */
  language: "en" | "uk";
  workspaceName: string;
  onAnswer: AnswerFn | null;
  /** No app tab bar below (the no-account link page): the sticky action bar sits at the very bottom. */
  standalone?: boolean;
}) {
  const t = useTranslations("App");
  const r = useTranslations("Report");
  const f = useFormat();
  const { fail } = useActionToast();
  // Server data is the base; answered cards are overridden locally (optimistic, then the API's Decision).
  const [local, setLocal] = useState<Record<string, Decision>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [live, setLive] = useState("");
  // Cards answered in this visit stay in place, so the confirmation is not hidden in the "Decided" list.
  const [kept, setKept] = useState<Set<string>>(new Set());
  const serverRef = useRef(items);
  useEffect(() => {
    // Fresh server data wins over stale local copies.
    if (serverRef.current !== items) {
      serverRef.current = items;
      setLocal({});
    }
  }, [items]);

  const merged = items.map((d) => local[d.id] ?? d);
  const openCount = merged.filter((d) => OPEN.includes(d.state)).length;
  const needs = merged.filter((d) => OPEN.includes(d.state) || kept.has(d.id));
  const decided = merged.filter((d) => !OPEN.includes(d.state) && !kept.has(d.id));
  const day = (iso: string) =>
    iso.length === 10 ? f.date(`${iso}T12:00:00Z`, "dayMonth", { timeZone: "UTC" }) : f.date(iso, "dayMonth");

  const send = async (d: Decision, answer: DecisionAnswer, text?: string): Promise<void> => {
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
    setKept((k) => new Set(k).add(d.id));
    setLocal((l) => ({ ...l, [d.id]: optimistic }));
    try {
      const saved = await onAnswer(d.id, answer, text);
      if (saved) setLocal((l) => ({ ...l, [d.id]: saved }));
      setLive(
        answer === "approve" ? t("odLiveApproved") : answer === "not_now" ? t("odLiveNotNow") : t("odLiveAsked"),
      );
    } catch (e) {
      setLocal((l) => {
        const rest = { ...l };
        delete rest[d.id];
        return before ? { ...rest, [d.id]: before } : rest;
      });
      setKept((k) => {
        const rest = new Set(k);
        rest.delete(d.id);
        return rest;
      });
      fail(e, r("whatAnswer"), () => void send(d, answer, text));
    } finally {
      setBusy((b) => ({ ...b, [d.id]: false }));
    }
  };

  // The first waiting decision gets the sticky action bar on a phone.
  const stickyId = needs.find((d) => OPEN.includes(d.state))?.id ?? null;
  const card = (d: Decision) => (
    <OwnerCard
      key={d.id}
      d={d}
      L={L}
      day={day}
      answered={kept.has(d.id)}
      readOnly={!onAnswer}
      busy={!!busy[d.id]}
      sticky={d.id === stickyId}
      standalone={standalone}
      onSend={(a, text) => void send(d, a, text)}
    />
  );

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header>
        <Kicker>{r("fromLine", { name: workspaceName })}</Kicker>
        <h1 className="mt-1 text-h1 text-ink">
          {openCount > 0 ? r("needYou", { n: openCount }) : r("nothingNow")}
        </h1>
      </header>
      <p role="status" aria-live="polite" className="sr-only">
        {live}
      </p>
      {needs.length === 0 && decided.length === 0 && (
        <Surface as="section" pad="sm" className="flex flex-col gap-1">
          <h2 className="text-h3 text-ink">{r("emptyTitle")}</h2>
          <p className="text-body text-ink-2">{r("emptyBody")}</p>
        </Surface>
      )}
      {needs.length > 0 && (
        <section aria-label={r("needYou", { n: openCount })} className="flex flex-col gap-3">
          {needs.map(card)}
        </section>
      )}
      {decided.length > 0 && (
        <Disclosure summary={<span className="text-h3">{r("decidedTitle", { n: decided.length })}</span>}>
          <ul className="flex flex-col gap-2 pt-3">
            {decided.map((d) => {
              const last = [...d.thread].reverse().find((e) => e.kind === "answer");
              const line =
                d.state === "approved" || d.state === "not_now" || d.state === "question"
                  ? r(`ownerAnswered_${d.state === "approved" ? "approve" : d.state}`, {
                      date: last ? day(last.at) : "",
                    })
                  : "";
              return (
                <li key={d.id}>
                  <Disclosure
                    className="rounded-card border border-line bg-surface px-3"
                    summary={
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-body font-semibold text-ink">
                          {d.fieldName} · {(d.question ?? d.title)[L]}
                        </span>
                        <span className="text-small font-normal text-ink-2">{line}</span>
                      </span>
                    }
                  >
                    <div className="pb-3">{card(d)}</div>
                  </Disclosure>
                </li>
              );
            })}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}

function OwnerCard({
  d,
  L,
  day,
  answered,
  readOnly,
  busy,
  sticky,
  standalone,
  onSend,
}: {
  d: Decision;
  L: "en" | "uk";
  day: (iso: string) => string;
  answered: boolean;
  readOnly: boolean;
  busy: boolean;
  sticky: boolean;
  standalone: boolean;
  onSend: (a: DecisionAnswer, text?: string) => void;
}) {
  const t = useTranslations("App");
  const r = useTranslations("Report");
  const f = useFormat();
  const [asking, setAsking] = useState(false);
  const [changing, setChanging] = useState(false);
  const [question, setQuestion] = useState("");
  const open = OPEN.includes(d.state);
  const note = d.thread.find((e) => e.kind === "note" && e.text);
  const overdue = d.deadline !== null && d.deadline < new Date().toISOString().slice(0, 10);
  const lastAnswer = [...d.thread].reverse().find((e) => e.kind === "answer");
  const who = d.askedBy.name || r("agronomistFallback");
  // The question in plain words; older data has none, so the title stands in.
  const ask = (d.question ?? d.title)[L];
  const split = splitOwnerNumbers(d);
  const fmt = { number: f.number, date: day };
  // An owner-friendly label of our own wins over the agronomist's `kn_*` label.
  const label = (id: string) =>
    r.has(`own_${id}`) ? r(`own_${id}` as "agroNote") : t.has(`kn_${id}`) ? t(`kn_${id}`) : null;
  const numbers = keyNumberViews({ keyNumbers: split.headline }, fmt, label);
  const evidenceNumbers = keyNumberViews({ keyNumbers: split.evidence }, fmt, label, 8);
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
    <Surface as="article" pad="sm" className={`flex flex-col gap-3 ${answered ? "animate-flash" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-small font-semibold text-ink">{d.fieldName}</p>
        {d.deadline && open && (
          <span
            className={`flex items-center gap-1 rounded-chip px-2.5 py-1 text-caption font-semibold ${overdue ? "bg-urgent-soft text-urgent" : "bg-week-soft text-week"}`}
          >
            <Clock aria-hidden className="size-3.5" />
            {overdue ? `${t("rpOverdue")} · ${day(d.deadline)}` : t("rpDeadline", { date: day(d.deadline) })}
          </span>
        )}
      </div>
      <h3 className="text-h3 text-ink">{ask}</h3>
      {/* Without a plain question the action sentence says what it is about; with one it moves to Evidence. */}
      {!d.question && <p className="text-body text-ink">{d.action[L]}</p>}
      {numbers.length > 0 && (
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
          {numbers.map((n) => (
            <div key={n.id} className="flex min-w-0 flex-col rounded-input bg-surface-2 p-2">
              <dd className="text-h3 font-semibold text-ink">{n.value}</dd>
              <dt className="text-small text-ink-2">{n.label}</dt>
            </div>
          ))}
        </dl>
      )}
      {note && (
        <blockquote className="border-l-2 border-line-control pl-3 text-body text-ink">
          <span className="block text-caption font-semibold text-ink-2">{r("agroNote", { name: who })}</span>
          {note.text}
        </blockquote>
      )}
      {thread.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={t("odThread")}>
          {thread.map((e) => {
            const mine = e.author.role === "owner";
            const name = e.kind === "answer" && e.answer ? t(`odAns_${e.answer}`) : "";
            // "Approved: Approved. Go ahead." — the label is skipped when the text already starts with it.
            const showLabel = name !== "" && !(e.text ?? "").toLowerCase().startsWith(name.toLowerCase());
            return (
              <li key={e.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                <div
                  className={`max-w-[85%] rounded-card px-3 py-2 text-small ${mine ? "bg-ink text-surface" : "bg-surface-2 text-ink"}`}
                >
                  {showLabel && (
                    <span className="font-semibold">
                      {name}
                      {e.text ? ": " : ""}
                    </span>
                  )}
                  {e.text}
                </div>
                <span className="mt-0.5 text-caption text-ink-3">
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
          className={`flex items-center gap-2 text-small font-semibold ${d.state === "question" ? "text-ink-2" : "text-ok"}`}
        >
          {d.state === "approved" ? (
            <Check aria-hidden className="size-4" />
          ) : d.state === "not_now" ? (
            <Pause aria-hidden className="size-4" />
          ) : (
            <MessageCircleQuestion aria-hidden className="size-4" />
          )}
          {stateLine}
          {answered && d.state !== "question" ? ` · ${r("sent")}` : ""}
        </p>
      )}
      {!readOnly && !open && !changing && (
        <Button variant="link" className="min-h-tap self-start" onClick={() => setChanging(true)}>
          {t("odChange")}
        </Button>
      )}
      {showButtons && (
        <ul className="flex flex-col gap-1 text-small text-ink-2">
          {(["approve", "not_now", "question"] as const).map((a) => (
            <li key={a}>
              <span className="font-semibold text-ink">{a === "question" ? r("btnAsk") : t(`odBtn_${a}`)}:</span>{" "}
              {r(`hint_${a}`, { name: who })}
            </li>
          ))}
        </ul>
      )}
      {showButtons && (
        <div
          role="group"
          aria-label={r("answerLabel")}
          className={`grid grid-cols-2 gap-2 sm:grid-cols-3 ${
            sticky
              ? `z-10 -mx-1 border-t border-line bg-surface px-1 py-2 max-lg:sticky ${
                  standalone ? "bottom-0" : "bottom-[calc(var(--ts-tabbar)+env(safe-area-inset-bottom))]"
                }`
              : ""
          }`}
        >
          {(["approve", "not_now", "question"] as const).map((a) => (
            <Button
              key={a}
              size={48}
              variant={a === "approve" ? "primary" : "outline"}
              icon={ANSWER_ICON[a]}
              disabled={busy}
              onClick={() => pick(a)}
              className={`w-full justify-center ${a === "approve" ? "col-span-2 sm:col-span-1" : ""}`}
            >
              {a === "question" ? r("btnAsk") : t(`odBtn_${a}`)}
            </Button>
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
            className="focus-ring min-h-24 rounded-input border border-line-control bg-surface p-3 text-body"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" size={48} className="w-full justify-center sm:flex-1" onClick={() => setAsking(false)}>
              {t("rpCancel")}
            </Button>
            <Button type="submit" size={48} className="w-full justify-center sm:flex-1" disabled={!question.trim() || busy}>
              {r("questionSend")}
            </Button>
          </div>
        </form>
      )}
      <Disclosure summary={<span className="text-small">{r("evidence")}</span>}>
        <div className="flex flex-col gap-2 pb-1 text-small text-ink-2">
          {d.question && <p className="text-ink">{d.title[L]}</p>}
          {d.question && <p>{d.action[L]}</p>}
          <p>
            <span className="font-semibold text-ink">{r("why")}: </span>
            {d.why[L]}
          </p>
          {evidenceNumbers.length > 0 && (
            <ul>
              {evidenceNumbers.map((n) => (
                <li key={n.id}>
                  {n.value} · {n.label}
                </li>
              ))}
            </ul>
          )}
          <p className="text-caption text-ink-3">{r("askedLine", { name: d.askedBy.name, date: day(d.askedAt) })}</p>
          <p className="text-caption text-ink-3">{r("foot")}</p>
        </div>
      </Disclosure>
    </Surface>
  );
}
