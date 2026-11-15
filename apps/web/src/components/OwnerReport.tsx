"use client";

import { Button } from "@terrasight/ui";
import { Check, Clock, MessageCircleQuestion } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

type Localised = { en: string; uk: string };
type Answer = "done" | "not_yet" | "question";
export interface ReportItem {
  id: string;
  fieldName: string;
  text: {
    title: Localised;
    action: Localised;
    why: Localised;
    scout: Localised | null;
    deadline: string | null;
  };
  note: string | null;
  changedSinceAccepted: boolean;
  latestAnswer: { answer: Answer; text: string | null; via: "user" | "link"; at: string } | null;
  replies: Array<{ text: string; at: string }>;
}
export interface ReportView {
  workspaceName: string;
  language: "en" | "uk";
  counts: { items: number; done: number; questions: number };
  fields: Array<{ fieldId: string; fieldName: string; items: ReportItem[] }>;
}

/** What the owner sees (design 16): plain items with action, deadline, reason, and one-tap answers. */
export function OwnerReport({
  report,
  onAnswer,
}: {
  report: ReportView;
  onAnswer: ((id: string, answer: Answer, text?: string) => Promise<unknown>) | null;
}) {
  const t = useTranslations("App");
  const r = useTranslations("Report");
  const L = report.language;
  const [asking, setAsking] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [thanks, setThanks] = useState<string | null>(null);
  const date = (iso: string) =>
    new Intl.DateTimeFormat(L === "uk" ? "uk-UA" : "en-US", {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
    }).format(new Date(`${iso}T12:00:00Z`));
  const overdue = (iso: string) => iso < new Date().toISOString().slice(0, 10);
  const answer = async (id: string, a: Answer, text?: string) => {
    if (!onAnswer) return;
    await onAnswer(id, a, text);
    setThanks(id);
    setAsking(null);
    setQuestion("");
  };
  const items = report.fields.flatMap((f) => f.items);
  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-small text-ink-2">
          {t("rpFrom")} · {report.workspaceName}
        </p>
        <h1 className="text-h1 text-ink">{r("h1")}</h1>
        {report.counts.items > 0 && (
          <div className="mt-3 flex items-center gap-3">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={report.counts.items}
              aria-valuenow={report.counts.done}
              aria-label={t("rpDoneCount", { done: report.counts.done, n: report.counts.items })}
              className="h-2 flex-1 overflow-hidden rounded-chip bg-muted"
            >
              <div
                className="h-full bg-ok transition-[width]"
                style={{ width: `${(report.counts.done / report.counts.items) * 100}%` }}
              />
            </div>
            <p className="text-small font-semibold whitespace-nowrap text-ink">
              {t("rpDoneCount", { done: report.counts.done, n: report.counts.items })}
            </p>
          </div>
        )}
      </header>
      {items.length > 0 && report.counts.done === items.length && (
        <p role="status" className="rounded-card bg-ok-soft p-4 text-body font-semibold text-ok">
          {t("rpAllDone")}
        </p>
      )}
      {items.length > 0 && report.counts.done < items.length && items.every((i) => i.latestAnswer) && (
        <p role="status" className="rounded-card bg-surface-2 p-4 text-small text-ink-2">
          {t("rpAllAnswered")}
        </p>
      )}
      {items.length === 0 && <p className="text-body text-ink-2">{t("rpEmpty")}</p>}
      {items.map((i) => (
        <article key={i.id} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-small font-semibold text-ink">{i.fieldName}</p>
            {i.text.deadline && (
              <span
                className={`flex items-center gap-1 rounded-chip px-2.5 py-1 text-small font-semibold ${overdue(i.text.deadline) ? "bg-urgent-soft text-urgent" : "bg-week-soft text-week"}`}
              >
                <Clock aria-hidden className="size-3.5" />
                {overdue(i.text.deadline)
                  ? `${t("rpOverdue")} · ${date(i.text.deadline)}`
                  : t("rpDeadline", { date: date(i.text.deadline) })}
              </span>
            )}
          </div>
          <h2 className="text-[18px] leading-6 font-semibold text-ink">{i.text.action[L]}</h2>
          <p className="text-body text-ink-2">
            <span className="font-semibold text-ink">{t("rpWhy")}: </span>
            {i.text.why[L]}
          </p>
          <p className="text-micro text-ink-3">{i.text.title[L]}</p>
          {i.text.scout && <p className="text-small text-week">{t("rpScout")}</p>}
          {i.note && <p className="text-small text-ink">{t("rpNote", { note: i.note })}</p>}
          {i.replies.map((rep, k) => (
            <p key={k} className="rounded-input bg-surface-2 p-3 text-small text-ink">
              {rep.text}
            </p>
          ))}
          {thanks === i.id && (
            <p role="status" className="text-small text-ok">
              {t("rpThanks")}
            </p>
          )}
          {onAnswer && (
            <div className="grid grid-cols-3 gap-2">
              {(["done", "not_yet", "question"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  aria-pressed={i.latestAnswer?.answer === a}
                  onClick={() => (a === "question" ? setAsking(i.id) : void answer(i.id, a))}
                  className={`focus-ring flex min-h-tap flex-col items-center justify-center gap-1 rounded-btn border px-1 text-small font-semibold ${i.latestAnswer?.answer === a ? "border-ink bg-ink text-surface" : "border-line-strong text-ink"}`}
                >
                  {a === "done" ? (
                    <Check aria-hidden className="size-4" />
                  ) : a === "not_yet" ? (
                    <Clock aria-hidden className="size-4" />
                  ) : (
                    <MessageCircleQuestion aria-hidden className="size-4" />
                  )}
                  {t(`rpAnswer_${a}`)}
                </button>
              ))}
            </div>
          )}
          {asking === i.id && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void answer(i.id, "question", question);
              }}
              className="flex flex-col gap-2"
            >
              <label htmlFor={`q-${i.id}`} className="text-small font-semibold text-ink">
                {t("rpAskLabel")}
              </label>
              <textarea
                id={`q-${i.id}`}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={t("rpAskPh")}
                maxLength={1000}
                className="min-h-20 rounded-input border border-line-strong bg-surface p-3 text-body"
              />
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" onClick={() => setAsking(null)}>
                  {t("rpCancel")}
                </Button>
                <Button type="submit">{t("rpSendQuestion")}</Button>
              </div>
            </form>
          )}
        </article>
      ))}
      <p className="text-micro text-ink-3">{t("rpFoot")}</p>
    </div>
  );
}
