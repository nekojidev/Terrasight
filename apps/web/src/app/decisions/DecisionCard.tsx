"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { Decision, DecisionAnswer, DecisionState, ThreadEntry } from "@terrasight/shared";
import { Button, Chip, Kicker, Skeleton, Surface, type ChipTone } from "@terrasight/ui";
import {
  Check,
  ChevronDown,
  Clock,
  MessageCircleQuestion,
  Pause,
  Pencil,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useActionToast } from "@/lib/useActionToast";
import { useFormat } from "@/lib/useFormat";
import { keyNumberViews } from "./key-numbers";

const STATE: Record<DecisionState, { tone: ChipTone; icon: ReactNode }> = {
  waiting: { tone: "week", icon: <Clock /> },
  question: { tone: "info", icon: <MessageCircleQuestion /> },
  approved: { tone: "ok", icon: <Check /> },
  not_now: { tone: "neutral", icon: <Pause /> },
};

const ANSWER_ICON: Record<DecisionAnswer, ReactNode> = {
  approve: <Check />,
  not_now: <Pause />,
  question: <MessageCircleQuestion />,
};

/** "12 Nov" for an ISO date or timestamp, through useFormat; a bare date is read as that calendar day. */
export function useDayFormat() {
  const f = useFormat();
  return (iso: string, withTime = false) =>
    iso.length === 10
      ? f.date(`${iso}T12:00:00Z`, "dayMonth", { timeZone: "UTC" })
      : f.date(iso, withTime ? "dateTime" : "dayMonth");
}

export function KeyNumbers({ d }: { d: Decision }) {
  const t = useTranslations("App");
  const f = useFormat();
  const day = useDayFormat();
  const numbers = keyNumberViews(d, { number: f.number, date: day }, (id) =>
    t.has(`kn_${id}`) ? t(`kn_${id}`) : null,
  );
  if (numbers.length === 0) return null;
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2">
      {numbers.map((n) => (
        <div key={n.id} className="flex min-w-0 flex-col rounded-input bg-surface-2 p-2">
          <dd className="text-body font-semibold text-ink">{n.value}</dd>
          <dt className="text-caption text-ink-2">{n.label}</dt>
        </div>
      ))}
    </dl>
  );
}

/** One message of the conversation: agronomist on the right (ink), owner on the left (info-soft). */
function Bubble({ e }: { e: ThreadEntry }) {
  const t = useTranslations("App");
  const when = useDayFormat();
  const owner = e.author.role === "owner";
  return (
    <li className={`flex flex-col gap-1 ${owner ? "items-start" : "items-end"}`}>
      <span className="text-caption text-ink-3">
        {e.author.name} · {when(e.at, true)}
        {e.via === "link" ? ` · ${t("decViaLink")}` : ""}
      </span>
      <div
        className={`flex max-w-[85%] flex-col gap-2 rounded-card px-4 py-3 text-body ${
          owner ? "rounded-tl-input bg-info-soft text-ink" : "rounded-tr-input bg-ink text-surface"
        }`}
      >
        {e.kind === "answer" && e.answer && (
          <Chip
            tone={e.answer === "approve" ? "ok" : e.answer === "not_now" ? "week" : "info"}
            icon={ANSWER_ICON[e.answer]}
            className="self-start"
          >
            {t(`decAns_${e.answer}`)}
          </Chip>
        )}
        {e.text && <p className="break-words whitespace-pre-wrap">{e.text}</p>}
      </div>
    </li>
  );
}

/** The agronomist's reply: a draft built from the item for a question (S-08.05), a plain composer otherwise. */
function Composer({ d, workspaceId, onSent }: { d: Decision; workspaceId: string; onSent: () => void }) {
  const t = useTranslations("App");
  const rp = useTranslations("Reports");
  const { fail } = useActionToast();
  const id = useId();
  const wantsDraft = d.state === "question";
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(wantsDraft);
  const [draft, setDraft] = useState(false);
  const [editing, setEditing] = useState(!wantsDraft);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!wantsDraft) return;
    let live = true;
    api<{ draft: string }>(`/api/w/${workspaceId}/decisions/${d.id}/reply-draft`, { body: {} })
      .then((r) => {
        if (!live) return;
        setText(r.draft);
        setDraft(true);
      })
      .catch(() => live && setEditing(true))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [wantsDraft, workspaceId, d.id]);

  const send = async (): Promise<void> => {
    setBusy(true);
    try {
      await api(`/api/w/${workspaceId}/decisions/${d.id}/replies`, { body: { text: text.trim() } });
      setText("");
      onSent();
    } catch (e) {
      fail(e, rp("whatReply"), () => void send());
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Skeleton variant="rows" rows={2} label={t("loading")} className="w-full" />;
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line-strong bg-surface-2 p-4">
      <label htmlFor={id} className="flex items-center gap-2 text-small font-semibold text-ink">
        {draft && <Sparkles aria-hidden className="size-4" strokeWidth={1.7} />}
        {draft ? t("decDraftTitle") : t("decReply")}
      </label>
      {editing || !draft ? (
        <textarea
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          className="focus-ring min-h-24 rounded-input border border-line-strong bg-surface p-3 text-body text-ink"
        />
      ) : (
        <p id={id} className="text-body whitespace-pre-wrap text-ink">
          {text}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={<Send />} disabled={busy || !text.trim()} onClick={() => void send()}>
          {t("decSend")}
        </Button>
        {draft && !editing && (
          <Button variant="outline" icon={<Pencil />} onClick={() => setEditing(true)}>
            {t("decEdit")}
          </Button>
        )}
        {draft && (
          <span className="flex items-center gap-1.5 text-small font-semibold text-ok sm:ml-auto">
            <ShieldCheck aria-hidden className="size-4" strokeWidth={1.7} />
            {t("decDraftFrom")}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * An item the agronomist asked the owner about. Collapsed it shows the field, the recommendation, when it was asked and
 * the status (icon + word); expanded it shows the note, key numbers, the thread and the reply composer. The parent
 * keeps one card open at a time, so one composer is open at a time.
 */
export function DecisionCard({
  d,
  workspaceId,
  canReply,
  open,
  onToggle,
}: {
  d: Decision;
  workspaceId: string;
  canReply: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("App");
  const rp = useTranslations("Reports");
  const locale = useLocale() as "en" | "uk";
  const client = useQueryClient();
  const day = useDayFormat();
  const [busy, setBusy] = useState(false);
  const { fail } = useActionToast();
  const refresh = () => client.invalidateQueries({ queryKey: ["decisions", workspaceId] });
  const s = STATE[d.state];
  const note = d.thread.find((e) => e.kind === "note" && e.text);
  const thread = d.thread.filter((e) => e.kind !== "note");
  // A question that was already replied to is no longer waiting for the agronomist.
  const lastAnswer = [...d.thread].reverse().find((e) => e.kind === "answer");
  const replied =
    d.state === "question" &&
    !!lastAnswer &&
    d.thread.some((e) => e.kind === "reply" && e.at > lastAnswer.at);
  const headId = useId();
  const bodyId = useId();
  const republish = async (): Promise<void> => {
    setBusy(true);
    try {
      await api(`/api/w/${workspaceId}/decisions/${d.id}/republish`, { body: {} });
      await refresh();
    } catch (e) {
      fail(e, rp("whatRepublish"), () => void republish());
    } finally {
      setBusy(false);
    }
  };
  return (
    <Surface as="article" aria-labelledby={headId} pad="none">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        className="focus-ring flex min-h-tap w-full items-start justify-between gap-3 rounded-card p-4 text-left sm:p-5"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <Kicker>{d.fieldName}</Kicker>
          <span id={headId} className="text-h3 text-ink">
            {d.title[locale]}
          </span>
          <span className="text-small text-ink-2">{t("decAsked", { date: day(d.askedAt), name: d.askedBy.name })}</span>
          <span className="mt-1 flex">
            <Chip tone={s.tone} icon={s.icon}>
              {t(`decState_${d.state}`)}
            </Chip>
          </span>
        </span>
        <ChevronDown
          aria-hidden
          strokeWidth={1.7}
          className={`mt-1 size-5 shrink-0 text-ink-2 transition-transform duration-base ease-ts ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div id={bodyId} className="animate-fade flex flex-col gap-4 border-t border-line p-4 sm:p-5">
          <div className="flex flex-col gap-2">
            <p className="text-body font-semibold text-ink">{d.action[locale]}</p>
            {d.deadline && <p className="text-small text-ink-2">{t("rpDeadline", { date: day(d.deadline) })}</p>}
            <Link
              href={`/fields/${d.fieldId}`}
              className="focus-ring inline-flex min-h-tap items-center self-start text-small font-semibold text-ink underline"
            >
              {rp("openField")}: {d.fieldName}
            </Link>
          </div>

          {note && (
            <blockquote className="border-l-2 border-line-control pl-3 text-body text-ink">
              <span className="block text-caption font-semibold text-ink-2">{rp("noteLabel")}</span>
              {note.text}
            </blockquote>
          )}

          {d.keyNumbers.length > 0 && (
            <div className="flex flex-col gap-2">
              <Kicker>{rp("numbersLabel")}</Kicker>
              <KeyNumbers d={d} />
            </div>
          )}

          {d.changedSinceAsked && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-input bg-week-soft p-3 text-small text-week">
              <span className="font-semibold">{t("decChanged")}</span>
              {canReply && (
                <Button variant="outline" icon={<RefreshCw />} disabled={busy} onClick={() => void republish()}>
                  {t("rpRepublish")}
                </Button>
              )}
            </div>
          )}

          {thread.length > 0 && (
            <ol aria-label={t("decThread")} className="flex flex-col gap-3">
              {thread.map((e) => (
                <Bubble key={e.id} e={e} />
              ))}
            </ol>
          )}

          {canReply && !replied && (
            <Composer
              key={`${d.id}:${d.thread.length}:${d.state}`}
              d={d}
              workspaceId={workspaceId}
              onSent={() => void refresh()}
            />
          )}
        </div>
      )}
    </Surface>
  );
}
