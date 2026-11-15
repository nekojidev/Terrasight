"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Decision, DecisionList } from "@terrasight/shared";
import { Button, Skeleton } from "@terrasight/ui";
import { Copy, Eye, Link2, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useMemo, useRef, useState } from "react";
import { OwnerDecisions } from "@/components/OwnerDecisions";
import { api } from "@/lib/api";
import { useWorkspaceEvents } from "@/lib/events";
import { DecisionCard } from "./DecisionCard";

type Role = "owner" | "admin" | "agronomist" | "viewer";
type Tab = "waiting" | "question" | "decided";
interface ReportLink {
  id: string;
  language: "en" | "uk";
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const TABS: Tab[] = ["waiting", "question", "decided"];
const tabOf = (d: Decision): Tab =>
  d.state === "waiting" ? "waiting" : d.state === "question" ? "question" : "decided";

/**
 * Owner decisions (design 15, PD v2.7): the items the agronomist asked the owner about, as cards with a thread.
 * Tabs Waiting · Questions · Decided; the rail shows who receives decisions, the invite and the no-account links.
 */
export function DecisionsClient({
  workspaceId,
  role,
  fieldId,
}: {
  workspaceId: string;
  role: Role;
  fieldId: string | null;
}) {
  const t = useTranslations("App");
  useWorkspaceEvents(workspaceId, ["brief"], () => [["decisions", workspaceId]]);
  const list = useQuery({
    queryKey: ["decisions", workspaceId],
    queryFn: () => api<DecisionList>(`/api/w/${workspaceId}/decisions?state=all`),
  });
  const [tab, setTab] = useState<Tab | null>(null);
  const preview = useRef<HTMLDialogElement>(null);
  const manage = role === "owner" || role === "admin";
  const canReply = role !== "viewer";

  const items = useMemo(
    () => (list.data?.items ?? []).filter((d) => !fieldId || d.fieldId === fieldId),
    [list.data, fieldId],
  );
  const counts = useMemo(() => {
    const c = { waiting: 0, question: 0, decided: 0 };
    for (const d of items) c[tabOf(d)]++;
    return c;
  }, [items]);

  if (list.isError && !list.data)
    return (
      <p role="alert" className="text-body text-ink-2">
        {t("errGeneric")}
      </p>
    );
  if (!list.data) return <Skeleton label={t("loading")} className="h-64 w-full" />;

  // Open on the tab that needs the agronomist most: questions, then waiting, then decided.
  const current: Tab = tab ?? (counts.question > 0 ? "question" : counts.waiting > 0 ? "waiting" : "decided");
  const shown = items.filter((d) => tabOf(d) === current);
  const recipients = list.data.recipients;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h1 text-ink">{t("decTitle")}</h1>
          <p className="text-body text-ink-2">{t("decSub")}</p>
        </div>
        <Button variant="outline" icon={<Eye />} onClick={() => preview.current?.showModal()}>
          {t("rqOwnerSees")}
        </Button>
      </header>

      {fieldId && (
        <p className="flex items-center gap-3 text-small text-ink-2">
          {t("rqFieldOnly")}
          <Link href="/decisions" className="font-semibold text-ink underline">
            {t("rqShowAll")}
          </Link>
        </p>
      )}

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div
            role="tablist"
            aria-label={t("decTitle")}
            className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-input bg-muted p-1"
          >
            {TABS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                id={`dec-tab-${k}`}
                aria-selected={current === k}
                aria-controls="dec-panel"
                onClick={() => setTab(k)}
                className={`focus-ring min-h-tap rounded-btn px-3 text-body font-semibold whitespace-nowrap sm:px-4 ${current === k ? "bg-ink text-surface" : "text-ink hover:bg-surface"}`}
              >
                {t(`decTab_${k}`)} <span className="font-mono">{counts[k]}</span>
              </button>
            ))}
          </div>
          <div
            id="dec-panel"
            role="tabpanel"
            aria-labelledby={`dec-tab-${current}`}
            className="flex flex-col gap-4"
          >
            {shown.length === 0 ? (
              <p className="rounded-card border border-line bg-surface p-6 text-body text-ink-2">
                {items.length === 0 ? t("decEmptyAll") : t(`decEmpty_${current}`)}
              </p>
            ) : (
              shown.map((d) => (
                <DecisionCard key={d.id} d={d} workspaceId={workspaceId} canReply={canReply} />
              ))
            )}
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <section className="rounded-card border border-line bg-surface p-5">
            <h2 className="mb-2 text-h3 text-ink">{t("decWho")}</h2>
            {recipients.length > 0 ? (
              <ul className="flex flex-col gap-1 text-body text-ink">
                {recipients.map((n) => (
                  <li key={n}>{t("rqOwnerLine", { name: n })}</li>
                ))}
              </ul>
            ) : (
              <p className="text-small text-ink-2">{t("decNoRecipients")}</p>
            )}
            <p className="mt-3 text-small text-ink-2">{t("decWhoSub")}</p>
            {manage && (
              <Link
                href="/settings/team"
                className="focus-ring mt-4 inline-flex min-h-tap items-center gap-2 text-body font-semibold text-ink underline"
              >
                <UserPlus aria-hidden className="size-4" />
                {t("teamManage")}
              </Link>
            )}
          </section>
          {manage && <Links workspaceId={workspaceId} />}
        </aside>
      </div>

      <Dialog ref={preview} title={t("rqOwnerSees")}>
        <OwnerDecisions
          items={list.data.items}
          language={list.data.language}
          workspaceName={list.data.workspaceName}
          onAnswer={null}
        />
      </Dialog>
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
          <Button variant="icon" label={t("rqClose")} icon={<X />} />
        </form>
      </div>
      <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
    </dialog>
  );
}

function Links({ workspaceId, bare = false }: { workspaceId: string; bare?: boolean }) {
  const t = useTranslations("App");
  const client = useQueryClient();
  const key = ["report-links", workspaceId];
  const headId = useId();
  const links = useQuery({
    queryKey: key,
    queryFn: () => api<ReportLink[]>(`/api/w/${workspaceId}/report-links`),
  });
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const body = (
    <>
      {!bare && (
        <h2 id={headId} className="text-h3 text-ink">
          {t("decLinkTitle")}
        </h2>
      )}
      <p className="mb-3 text-small text-ink-2">{t("decLinkSub")}</p>
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
          <code className="text-micro break-all text-ink">{fresh}</code>
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
  return bare ? (
    body
  ) : (
    <section aria-labelledby={headId} className="rounded-card border border-line bg-surface p-5">
      {body}
    </section>
  );
}
