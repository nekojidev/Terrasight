"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Decision, DecisionList } from "@terrasight/shared";
import { UserPlus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { OwnerDecisions } from "@/components/OwnerDecisions";
import { QueryState } from "@/components/QueryState";
import { api } from "@/lib/api";
import { ReportLinks } from "./ReportLinks";

/** The Owner's decisions: the answering view, plus the report links and a way to the Team page. */
export function OwnerDecisionsClient({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("App");
  const client = useQueryClient();
  const key = ["decisions", workspaceId, "all"];
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<DecisionList>(`/api/w/${workspaceId}/decisions?state=all`),
  });
  if (!list.data) return <QueryState query={list}>{() => null}</QueryState>;
  return (
    <div className="mx-auto grid max-w-[900px] gap-6 lg:grid-cols-[minmax(0,520px)_minmax(0,340px)]">
      <OwnerDecisions
        items={list.data.items}
        language={list.data.language}
        workspaceName={list.data.workspaceName}
        onAnswer={async (id, answer, text) => {
          const saved = await api<Decision>(`/api/w/${workspaceId}/decisions/${id}/answer`, {
            body: { answer, ...(text ? { text } : {}) },
          });
          void client.invalidateQueries({ queryKey: key });
          return saved;
        }}
      />
      <aside className="flex min-w-0 flex-col gap-4">
        <ReportLinks workspaceId={workspaceId} />
        <Link
          href="/settings/team"
          className="focus-ring inline-flex min-h-tap items-center gap-2 text-body font-semibold text-ink underline"
        >
          <UserPlus aria-hidden className="size-4" />
          {t("teamManage")}
        </Link>
      </aside>
    </div>
  );
}
