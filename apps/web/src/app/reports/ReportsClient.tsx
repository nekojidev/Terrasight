"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Skeleton } from "@terrasight/ui";
import {
  Check,
  ChevronRight,
  Clock,
  Copy,
  Eye,
  FileText,
  Link2,
  Mail,
  MessageCircleQuestion,
  Pencil,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  UserPlus,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { OwnerReport, type ReportItem, type ReportView } from "@/components/OwnerReport";
import { api } from "@/lib/api";
import { useWorkspaceEvents } from "@/lib/events";

type Role = "owner" | "admin" | "agronomist" | "viewer";
type Item = ReportItem & { committedAt: string; fieldId: string };
type View = ReportView & { recipients?: string[] };
interface ReportLink {
  id: string;
  language: "en" | "uk";
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const monthKey = (iso: string) => iso.slice(0, 7);

/**
 * Reports (design 15): the month's items with the owner's one-tap answers, a reply draft under each question,
 * past months, how the owner gets the report, report links. "What the owner sees" opens the owner's view (design 16).
 */
export function ReportsClient({
  workspaceId,
  role,
  fieldId,
}: {
  workspaceId: string;
  role: Role;
  fieldId: string | null;
}) {
  const t = useTranslations("App");
  const rs = useTranslations("Reports");
  const locale = useLocale() as "en" | "uk";
  const client = useQueryClient();
  useWorkspaceEvents(workspaceId, ["brief"], () => [["report", workspaceId]]);
  const report = useQuery({
    queryKey: ["report", workspaceId, fieldId],
    queryFn: () => api<View>(`/api/w/${workspaceId}/report${fieldId ? `?field=${fieldId}` : ""}`),
  });
  const refresh = () => void client.invalidateQueries({ queryKey: ["report", workspaceId] });
  const [month, setMonth] = useState<string | null>(null);
  const preview = useRef<HTMLDialogElement>(null);
  const share = useRef<HTMLDialogElement>(null);
  const manage = role === "owner" || role === "admin";

  const items = useMemo(() => (report.data?.fields.flatMap((f) => f.items) ?? []) as Item[], [report.data]);
  const months = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of items)
      (
        m.get(monthKey(i.committedAt)) ?? m.set(monthKey(i.committedAt), []).get(monthKey(i.committedAt))!
      ).push(i);
    return [...m.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [items]);

  if (report.isError && !report.data) return <p className="text-body text-ink-2">{t("errGeneric")}</p>;
  if (!report.data) return <Skeleton label={t("loading")} />;
  if (role === "viewer") {
    return (
      <div className="mx-auto max-w-[520px]">
        <OwnerReport
          report={report.data}
          onAnswer={async (id, answer, text) => (
            await api(`/api/w/${workspaceId}/report-items/${id}/answers`, {
              body: { answer, ...(text ? { text } : {}) },
            }),
            refresh()
          )}
        />
      </div>
    );
  }

  const fmtMonth = (key: string) =>
    new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    })
      .format(new Date(`${key}-15T12:00:00Z`))
      .replace(/^./, (c) => c.toUpperCase());
  const current = month ?? months[0]?.[0] ?? null;
  const shown = months.find(([k]) => k === current)?.[1] ?? [];
  const past = months.filter(([k]) => k !== months[0]?.[0]);
  const recipients = report.data.recipients ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h1 text-ink">{rs("title")}</h1>
          <p className="text-body text-ink-2">{rs("sub")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" icon={<Eye />} onClick={() => preview.current?.showModal()}>
            {t("rqOwnerSees")}
          </Button>
          {manage && (
            <Button icon={<Link2 />} onClick={() => share.current?.showModal()}>
              {t("rqShare")}
            </Button>
          )}
        </div>
      </header>

      {fieldId && (
        <p className="flex items-center gap-3 text-small text-ink-2">
          {t("rqFieldOnly")}
          <Link href="/reports" className="font-semibold text-ink underline">
            {t("rqShowAll")}
          </Link>
        </p>
      )}

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {!current ? (
            <p className="rounded-card border border-line bg-surface p-6 text-body text-ink-2">
              {t("rpEmpty")}
            </p>
          ) : (
            <MonthCard
              title={fmtMonth(current)}
              items={shown}
              recipients={recipients}
              workspaceId={workspaceId}
              lang={report.data.language}
              uiLang={locale}
              onChange={refresh}
              back={month && month !== months[0]?.[0] ? () => setMonth(null) : null}
              backLabel={months[0] ? t("rqBack", { month: fmtMonth(months[0][0]) }) : ""}
            />
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <section className="rounded-card border border-line bg-surface p-5">
            <h2 className="mb-2 text-h3 text-ink">{t("rqPast")}</h2>
            {past.length === 0 ? (
              <p className="text-small text-ink-2">{t("rqPastEmpty")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {past.map(([k, list]) => (
                  <li key={k}>
                    <button
                      type="button"
                      onClick={() => setMonth(k)}
                      className="focus-ring flex w-full items-center gap-3 py-3 text-left"
                    >
                      <FileText aria-hidden className="size-5 text-ink-2" strokeWidth={1.7} />
                      <span className="flex-1">
                        <span className="block text-body font-semibold text-ink">{fmtMonth(k)}</span>
                        <span className="text-small text-ink-2">
                          {t("rqPastMeta", {
                            done: list.filter((i) => i.latestAnswer?.answer === "done").length,
                            n: list.length,
                          })}
                        </span>
                      </span>
                      <ChevronRight aria-hidden className="size-5 text-ink-2" strokeWidth={1.7} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-card border border-line bg-surface p-5">
            <h2 className="mb-3 text-h3 text-ink">{t("rqDelivery")}</h2>
            <ul className="flex flex-col gap-2 text-small text-ink">
              <li className="flex gap-2">
                <Zap aria-hidden className="size-4 shrink-0 translate-y-0.5" strokeWidth={1.7} />
                {t("rqDelivery1")}
              </li>
              <li className="flex gap-2">
                <Mail aria-hidden className="size-4 shrink-0 translate-y-0.5" strokeWidth={1.7} />
                {t("rqDelivery2")}
              </li>
              <li className="flex gap-2">
                <Check aria-hidden className="size-4 shrink-0 translate-y-0.5" strokeWidth={1.7} />
                {t("rqDelivery3")}
              </li>
            </ul>
            {manage && recipients.length === 0 && <Invite workspaceId={workspaceId} />}
          </section>

          {manage && <Links workspaceId={workspaceId} />}
        </aside>
      </div>

      <Dialog ref={preview} title={t("rqOwnerSees")}>
        <OwnerReport report={report.data} onAnswer={null} />
      </Dialog>
      {manage && (
        <Dialog ref={share} title={t("rqShare")}>
          <Links workspaceId={workspaceId} bare />
        </Dialog>
      )}
    </div>
  );
}

function Dialog({
  ref,
  title,
  children,
}: {
  ref: React.Ref<HTMLDialogElement>;
  title: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("App");
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-hero bg-bg p-0 text-ink shadow-sheet backdrop:bg-ink/40 dark:backdrop:bg-bg/70"
      onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
    >
      <div className="flex items-center justify-between border-b border-line bg-surface px-5 py-3">
        <h2 className="text-h3">{title}</h2>
        <form method="dialog">
          <Button variant="icon" aria-label={t("rqClose")} icon={<X />} />
        </form>
      </div>
      <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
    </dialog>
  );
}

function MonthCard({
  title,
  items,
  recipients,
  workspaceId,
  lang,
  uiLang,
  onChange,
  back,
  backLabel,
}: {
  title: string;
  items: Item[];
  recipients: string[];
  workspaceId: string;
  lang: "en" | "uk";
  uiLang: "en" | "uk";
  onChange: () => void;
  back: (() => void) | null;
  backLabel: string;
}) {
  const t = useTranslations("App");
  const first = items.reduce((m, i) => (i.committedAt < m ? i.committedAt : m), items[0]!.committedAt);
  const answered = items.filter((i) => i.latestAnswer).length;
  const day = (iso: string) =>
    new Intl.DateTimeFormat(uiLang === "uk" ? "uk-UA" : "en-US", { day: "numeric", month: "long" }).format(
      new Date(iso),
    );
  return (
    <section className="rounded-hero border border-line bg-surface p-6">
      {back && (
        <Button variant="link" className="mb-3" onClick={back}>
          {backLabel}
        </Button>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
        <div>
          <h2 className="text-h2 text-ink">{title}</h2>
          <p className="text-small text-ink-2">
            {recipients.length
              ? t("rqSentTo", { date: day(first), who: recipients.join(", ") })
              : t("rqSentNoOne", { date: day(first) })}
          </p>
        </div>
        <div className="flex w-[180px] flex-col gap-2">
          <span className="text-right text-small font-semibold text-ink">
            {t("rqReplies", { n: answered, total: items.length })}
          </span>
          <span className="h-1.5 overflow-hidden rounded-chip bg-muted" aria-hidden>
            <span
              className="block h-full bg-ink"
              style={{ width: `${items.length ? (answered / items.length) * 100 : 0}%` }}
            />
          </span>
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {items.map((i) => (
          <ItemRow
            key={i.id}
            item={i}
            workspaceId={workspaceId}
            lang={lang}
            uiLang={uiLang}
            day={day}
            onChange={onChange}
          />
        ))}
      </ul>
    </section>
  );
}

const STATUS = {
  done: { icon: Check, box: "bg-ok-soft text-ok", text: "text-ok" },
  not_yet: { icon: Clock, box: "bg-week-soft text-week", text: "text-week" },
  question: { icon: MessageCircleQuestion, box: "bg-info-soft text-info", text: "text-info" },
  none: { icon: Send, box: "bg-muted text-ink-2", text: "text-ink-2" },
} as const;

function ItemRow({
  item,
  workspaceId,
  lang,
  uiLang,
  day,
  onChange,
}: {
  item: Item;
  workspaceId: string;
  lang: "en" | "uk";
  uiLang: "en" | "uk";
  day: (iso: string) => string;
  onChange: () => void;
}) {
  const t = useTranslations("App");
  const a = item.latestAnswer;
  const kind = a?.answer ?? "none";
  const s = STATUS[kind];
  const Icon = s.icon;
  const replied = item.replies.length > 0 && a?.answer === "question" && item.replies.at(-1)!.at > a.at;
  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex items-start gap-3">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-input ${s.box}`}
          aria-hidden
        >
          <Icon className="size-5" strokeWidth={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-ink">
            {item.text.title[uiLang]} · {item.fieldName}
          </p>
          <p className={`text-small font-semibold ${s.text}`}>
            {kind === "none"
              ? t("rqStatus_none", { date: day(item.committedAt) })
              : t(`rqStatus_${kind}`, { date: day(a!.at) })}
            {a?.via === "link" ? ` · ${t("rpVia")}` : ""}
          </p>
        </div>
        {item.changedSinceAccepted && (
          <Button
            variant="outline"
            size={44}
            icon={<RefreshCw />}
            onClick={async () => (
              await api(`/api/w/${workspaceId}/report-items/${item.id}/republish`, { body: {} }),
              onChange()
            )}
          >
            {t("rpChanged")} · {t("rpRepublish")}
          </Button>
        )}
      </div>
      {a?.answer === "question" && a.text && (
        <p className="ml-12 rounded-input bg-info-soft p-3 text-body text-ink">“{a.text}”</p>
      )}
      {item.replies.map((r, k) => (
        <p key={k} className="ml-12 rounded-input bg-surface-2 p-3 text-small text-ink">
          <span className="font-semibold">{t("rpReplied")}:</span> {r.text}
        </p>
      ))}
      {a?.answer === "question" && !replied && (
        <Draft item={item} workspaceId={workspaceId} lang={lang} onSent={onChange} />
      )}
    </li>
  );
}

/** The reply draft built from the item (S-08.05); the agronomist sends it as is or edits it first. */
function Draft({
  item,
  workspaceId,
  onSent,
}: {
  item: Item;
  workspaceId: string;
  lang: "en" | "uk";
  onSent: () => void;
}) {
  const t = useTranslations("App");
  const [text, setText] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void api<{ draft: string }>(`/api/w/${workspaceId}/report-items/${item.id}/reply-draft`, {
      body: {},
    }).then((d) => live && setText(d.draft));
    return () => {
      live = false;
    };
  }, [workspaceId, item.id]);
  if (text === null) return <Skeleton label={t("loading")} className="ml-12" />;
  return (
    <div className="ml-12 flex flex-col gap-3 rounded-card border border-line bg-surface-2 p-4">
      <p className="flex items-center gap-2 text-small font-semibold text-ink">
        <Sparkles aria-hidden className="size-4" strokeWidth={1.7} />
        {t("rqDraftTitle")}
      </p>
      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={t("rqDraftTitle")}
          className="min-h-28 rounded-input border border-line-strong bg-surface p-3 text-body"
        />
      ) : (
        <p className="text-body text-ink">{text}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          icon={<Send />}
          disabled={busy || !text.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await api(`/api/w/${workspaceId}/report-items/${item.id}/replies`, { body: { text } });
              onSent();
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("rqSend")}
        </Button>
        {!editing && (
          <Button variant="outline" icon={<Pencil />} onClick={() => setEditing(true)}>
            {t("rqEdit")}
          </Button>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-small font-semibold text-ok">
          <ShieldCheck aria-hidden className="size-4" strokeWidth={1.7} />
          {t("rqDraftFrom")}
        </span>
      </div>
    </div>
  );
}

function Invite({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("App");
  const [email, setEmail] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  if (url)
    return (
      <div className="mt-4 flex flex-col gap-2 rounded-input bg-surface-2 p-3">
        <code className="break-all text-micro text-ink">{url}</code>
        <Button variant="ghost" icon={<Copy />} onClick={() => void navigator.clipboard.writeText(url)}>
          {t("rpCopy")}
        </Button>
      </div>
    );
  return (
    <form
      className="mt-4 flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const inv = await api<{ token: string }>(`/api/w/${workspaceId}/invitations`, {
          body: { email, role: "viewer" },
        });
        setUrl(`${window.location.origin}/invite/${inv.token}`);
      }}
    >
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-label={t("rqInvite")}
        placeholder="owner@company.com"
        className="min-h-tap min-w-0 flex-1 rounded-input border border-line-strong bg-surface px-3 text-body"
      />
      <Button type="submit" variant="outline" icon={<UserPlus />}>
        {t("rqInvite")}
      </Button>
    </form>
  );
}

function Links({ workspaceId, bare = false }: { workspaceId: string; bare?: boolean }) {
  const t = useTranslations("App");
  const client = useQueryClient();
  const key = ["report-links", workspaceId];
  const links = useQuery({
    queryKey: key,
    queryFn: () => api<ReportLink[]>(`/api/w/${workspaceId}/report-links`),
  });
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const body = (
    <>
      {!bare && <h2 className="text-h3 text-ink">{t("rpLinks")}</h2>}
      <p className="mb-3 text-small text-ink-2">{t("rpLinksSub")}</p>
      <Button
        variant="outline"
        icon={<Link2 />}
        onClick={async () => {
          const l = await api<{ path: string }>(`/api/w/${workspaceId}/report-links`, {
            body: { language: "en" },
          });
          setFresh(`${window.location.origin}${l.path}`);
          setCopied(false);
          void client.invalidateQueries({ queryKey: key });
        }}
      >
        {t("rpNewLink")}
      </Button>
      {fresh && (
        <div className="mt-3 flex flex-col gap-2 rounded-input bg-surface-2 p-3">
          <p className="text-small text-week">{t("rpLinkOnce")}</p>
          <code className="break-all text-micro text-ink">{fresh}</code>
          <Button
            variant="ghost"
            icon={<Copy />}
            onClick={() => void navigator.clipboard.writeText(fresh).then(() => setCopied(true))}
          >
            {copied ? t("rpCopied") : t("rpCopy")}
          </Button>
        </div>
      )}
      <ul className="mt-3 flex flex-col gap-2">
        {(links.data ?? []).map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-2 text-small text-ink-2">
            <span>
              {new Date(l.createdAt).toLocaleDateString()} · {l.language.toUpperCase()}
              {l.revokedAt ? ` · ${t("rpRevoked")}` : ""}
            </span>
            {!l.revokedAt && (
              <Button
                variant="link"
                onClick={async () => (
                  await api(`/api/w/${workspaceId}/report-links/${l.id}`, { method: "DELETE" }),
                  client.invalidateQueries({ queryKey: key })
                )}
              >
                {t("rpRevoke")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
  return bare ? body : <section className="rounded-card border border-line bg-surface p-5">{body}</section>;
}
