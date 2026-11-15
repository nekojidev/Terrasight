"use client";

import { useQuery } from "@tanstack/react-query";
import type { Decision, DecisionList } from "@terrasight/shared";
import { Button, Surface, Tabs } from "@terrasight/ui";
import { Eye, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { OwnerDecisions } from "@/components/OwnerDecisions";
import { QueryState } from "@/components/QueryState";
import { api } from "@/lib/api";
import { useWorkspaceEvents } from "@/lib/events";
import { DecisionCard } from "./DecisionCard";
import { ReportLinks } from "./ReportLinks";

type Tab = "waiting" | "answered";
const tabOf = (d: Decision): Tab => (d.state === "waiting" ? "waiting" : "answered");
/** Questions first: they need the agronomist's reply. */
const rank = (d: Decision) => (d.state === "question" ? 0 : 1);

/**
 * Decisions, agronomist view: the items asked of the owner, as collapsed cards (one open at a time) with a thread.
 * Tabs Waiting for the owner · Answered (an owner's question sits in Answered, first); the rail shows who receives
 * decisions and the link for the owner. The Owner answers in OwnerDecisionsClient.
 */
export function DecisionsClient({ workspaceId, fieldId }: { workspaceId: string; fieldId: string | null }) {
  const t = useTranslations("App");
  const rp = useTranslations("Reports");
  useWorkspaceEvents(workspaceId, ["brief"], () => [["decisions", workspaceId]]);
  const list = useQuery({
    queryKey: ["decisions", workspaceId],
    queryFn: () => api<DecisionList>(`/api/w/${workspaceId}/decisions?state=all`),
  });
  const [tab, setTab] = useState<Tab | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const preview = useRef<HTMLDialogElement>(null);

  const items = useMemo(
    () => (list.data?.items ?? []).filter((d) => !fieldId || d.fieldId === fieldId),
    [list.data, fieldId],
  );
  const counts = useMemo(() => {
    const c: Record<Tab, number> = { waiting: 0, answered: 0 };
    for (const d of items) c[tabOf(d)]++;
    return c;
  }, [items]);

  if (!list.data)
    return (
      <QueryState query={list} skeletonVariant="rows" what={rp("whatDecisions")}>
        {() => null}
      </QueryState>
    );

  // Open on the tab that needs the agronomist most: an owner's question, then waiting, then answered.
  const hasQuestion = items.some((d) => d.state === "question");
  const current: Tab = tab ?? (hasQuestion || counts.waiting === 0 ? "answered" : "waiting");
  const shown = items.filter((d) => tabOf(d) === current).sort((a, b) => rank(a) - rank(b));
  const recipients = list.data.recipients;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h1 text-ink">{rp("title")}</h1>
          <p className="text-body text-ink-2">{rp("sub")}</p>
        </div>
        <Button variant="outline" icon={<Eye />} onClick={() => preview.current?.showModal()}>
          {t("rqOwnerSees")}
        </Button>
      </header>

      {fieldId && (
        <p className="flex items-center gap-3 text-small text-ink-2">
          {t("rqFieldOnly")}
          <Link href="/decisions" className="focus-ring inline-flex min-h-tap items-center font-semibold text-ink underline">
            {t("rqShowAll")}
          </Link>
        </p>
      )}

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Tabs
            label={rp("tabs")}
            value={current}
            onChange={(id) => {
              setTab(id as Tab);
              setOpenId(null);
            }}
            items={[
              { id: "waiting", label: rp("tab_waiting"), count: counts.waiting },
              { id: "answered", label: rp("tab_answered"), count: counts.answered },
            ]}
          />
          <div role="tabpanel" className="flex flex-col gap-3">
            {shown.length === 0 ? (
              <p className="rounded-card border border-line bg-surface p-6 text-body text-ink-2">
                {items.length === 0 ? rp("empty_all") : rp(`empty_${current}`)}
              </p>
            ) : (
              shown.map((d) => (
                <DecisionCard
                  key={d.id}
                  d={d}
                  workspaceId={workspaceId}
                  canReply
                  open={openId === d.id}
                  onToggle={() => setOpenId(openId === d.id ? null : d.id)}
                />
              ))
            )}
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <ReportLinks workspaceId={workspaceId} />
          <Surface as="section">
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
          </Surface>
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
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-hero bg-bg p-0 text-ink shadow-sheet backdrop:bg-scrim"
      onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
    >
      <div className="flex items-center justify-between border-b border-line bg-surface px-5 py-3">
        <h2 className="text-h3">{title}</h2>
        <form method="dialog">
          <Button variant="icon" label={t("rqClose")} icon={<X />} />
        </form>
      </div>
      <div className="max-h-[75dvh] overflow-y-auto p-5">{children}</div>
    </dialog>
  );
}
