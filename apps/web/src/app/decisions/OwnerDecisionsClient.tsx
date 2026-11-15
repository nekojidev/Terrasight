"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Decision, DecisionList } from "@terrasight/shared";
import { Skeleton } from "@terrasight/ui";
import { useTranslations } from "next-intl";
import { OwnerDecisions } from "@/components/OwnerDecisions";
import { api } from "@/lib/api";

/** The Viewer's (owner / manager) home: decisions that need them. */
export function OwnerDecisionsClient({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("App");
  const client = useQueryClient();
  const key = ["decisions", workspaceId, "all"];
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<DecisionList>(`/api/w/${workspaceId}/decisions?state=all`),
  });
  if (list.isError && !list.data) return <p className="text-body text-ink-2">{t("errGeneric")}</p>;
  if (!list.data) return <Skeleton label={t("loading")} />;
  return (
    <div className="mx-auto max-w-[520px]">
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
    </div>
  );
}
