"use client";

import { ReportLinks } from "./ReportLinks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Decision, DecisionList } from "@terrasight/shared";
import { useTranslations } from "next-intl";
import { OwnerDecisions } from "@/components/OwnerDecisions";
import { QueryState } from "@/components/QueryState";
import { api } from "@/lib/api";
import { useWorkspaceEvents } from "@/lib/events";

/** The Owner's decisions: the answering view, then the no-account links (only the Owner manages them). */
export function OwnerDecisionsClient({ workspaceId }: { workspaceId: string }) {
  const rp = useTranslations("Reports");
  const client = useQueryClient();
  const key = ["decisions", workspaceId, "all"];
  // A question the agronomist has just asked appears without a reload (it is published after the 8 s Undo window).
  useWorkspaceEvents(workspaceId, ["brief"], () => [["decisions", workspaceId]]);
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<DecisionList>(`/api/w/${workspaceId}/decisions?state=all`),
  });
  if (!list.data)
    return (
      <QueryState query={list} skeletonVariant="rows" what={rp("whatDecisions")}>
        {() => null}
      </QueryState>
    );
  return (
    <div className="mx-auto w-full max-w-[640px]">
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
      {/* Only the Owner manages no-account links (Product Definition, roles). */}
      <div className="mt-6">
        <ReportLinks workspaceId={workspaceId} />
      </div>
    </div>
  );
}
