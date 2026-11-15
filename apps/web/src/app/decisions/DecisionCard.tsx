"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { Decision, DecisionAnswer, DecisionState, ThreadEntry } from "@terrasight/shared";
import { Button, Chip, Skeleton, type ChipTone } from "@terrasight/ui";
import {
  Check,
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

/** "12 Nov": dates by UI language. */
export function useDateFormat() {
  const locale = useLocale();
  return (iso: string, withTime = false) =>
    new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
      day: "numeric",
      month: "short",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    }).format(new Date(iso));
}

export function KeyNumbers({ d }: { d: Decision }) {
  const t = useTranslations("App");
  const iso = useDateFormat();
  if (d.keyNumbers.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-small text-ink-2">
      {d.keyNumbers.slice(0, 4).map((k) => (
        <li key={k.id}>
          <span className="font-mono font-semibold text-ink">
            {typeof k.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k.value)
              ? iso(`${k.value}T12:00:00Z`)
              : String(k.value)}
            {k.unit && k.unit !== "seasons" ? ` ${k.unit}` : ""}
          </span>{" "}
          {t.has(`kn_${k.id}`) ? t(`kn_${k.id}`) : k.id}
        </li>
      ))}
    </ul>
  );
}

/** One message of the conversation: agronomist on the right (ink), owner on the left (info-soft). */
function Bubble({ e }: { e: ThreadEntry }) {
  const t = useTranslations("App");
  const when = useDateFormat();
  const owner = e.author.role === "owner";
  return (
    <li className={`flex flex-col gap-1 ${owner ? "items-start" : "items-end"}`}>
      <span className="text-micro text-ink-3">
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
  const id = useId();
  const wantsDraft = d.state === "question";
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(wantsDraft);
  const [draft, setDraft] = useState(false);
  const [editing, setEditing] = useState(!wantsDraft);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

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

  if (loading) return <Skeleton label={t("loading")} className="h-24 w-full" />;
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
      {failed && (
        <p role="alert" className="text-small text-urgent">
          {t("errGeneric")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          icon={<Send />}
          disabled={busy || !text.trim()}
          onClick={async () => {
            setBusy(true);
            setFailed(false);
            try {
              await api(`/api/w/${workspaceId}/decisions/${d.id}/replies`, { body: { text: text.trim() } });
              setText("");
              onSent();
            } catch {
              setFailed(true);
            } finally {
              setBusy(false);
            }
          }}
        >
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

/** A decision card (PD v2.7): what was asked, its state, the thread and the reply box. */
export function DecisionCard({
  d,
  workspaceId,
  canReply,
}: {
  d: Decision;
  workspaceId: string;
  canReply: boolean;
}) {
  const t = useTranslations("App");
  const locale = useLocale() as "en" | "uk";
  const client = useQueryClient();
  const day = useDateFormat();
  const [busy, setBusy] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: ["decisions", workspaceId] });
  const s = STATE[d.state];
  // A question that was already replied to is no longer waiting for the agronomist.
  const lastAnswer = [...d.thread].reverse().find((e) => e.kind === "answer");
  const replied =
    d.state === "question" &&
    !!lastAnswer &&
    d.thread.some((e) => e.kind === "reply" && e.at > lastAnswer.at);
  const headId = useId();
  return (
    <article
      aria-labelledby={headId}
      className="flex flex-col gap-4 rounded-hero border border-line bg-surface p-5 sm:p-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-small text-ink-2">
            <Link href={`/fields/${d.fieldId}`} className="font-semibold text-ink hover:underline">
              {d.fieldName}
            </Link>
            {" · "}
            {t("decAsked", { date: day(d.askedAt), name: d.askedBy.name })}
          </p>
          <h3 id={headId} className="text-h3 text-ink">
            {d.title[locale]}
          </h3>
        </div>
        <Chip tone={s.tone} icon={s.icon}>
          {t(`decState_${d.state}`)}
        </Chip>
      </header>

      <div className="flex flex-col gap-2 rounded-input bg-surface-2 p-4">
        <p className="text-body font-semibold text-ink">{d.action[locale]}</p>
        {d.deadline && (
          <p className="text-small text-ink-2">{t("rpDeadline", { date: day(`${d.deadline}T12:00:00Z`) })}</p>
        )}
        <KeyNumbers d={d} />
      </div>

      {d.changedSinceAsked && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-input bg-week-soft p-3 text-small text-week">
          <span className="font-semibold">{t("decChanged")}</span>
          {canReply && (
            <Button
              variant="outline"
              size={44}
              icon={<RefreshCw />}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/api/w/${workspaceId}/decisions/${d.id}/republish`, { body: {} });
                  await refresh();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("rpRepublish")}
            </Button>
          )}
        </div>
      )}

      {d.thread.length > 0 && (
        <ol aria-label={t("decThread")} className="flex flex-col gap-3">
          {d.thread.map((e) => (
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
    </article>
  );
}
