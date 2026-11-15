"use client";

import { useQuery } from "@tanstack/react-query";
import type { DecisionList } from "@terrasight/shared";
import { Surface } from "@terrasight/ui";
import { Check, Clock, HelpCircle, MessageSquare, Pause } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useWorkspaceEvents } from "@/lib/events";
import { useFormat } from "@/lib/useFormat";

/**
 * The owner's answer, shown on the recommendation itself: the agronomist has no separate Decisions item in the
 * navigation, so the state (waiting / approved / not now / question) and the way into the conversation live here.
 */
export function OwnerAnswer({ workspaceId, recommendationId }: { workspaceId: string; recommendationId: string }) {
  const t = useTranslations("Rec");
  const a = useTranslations("App");
  const f = useFormat();
  useWorkspaceEvents(workspaceId, ["brief"], () => [["decisions", workspaceId]]);
  const list = useQuery({
    queryKey: ["decisions", workspaceId, "all"],
    queryFn: () => api<DecisionList>(`/api/w/${workspaceId}/decisions?state=all`),
    retry: false,
  });
  const d = list.data?.items.find((i) => i.recommendationId === recommendationId);
  // Within the 8 s Undo window (or when the list failed) there is no decision yet: the status line above covers it.
  if (!d) return null;
  const last = [...d.thread].reverse().find((e) => e.kind === "answer");
  const icon =
    d.state === "approved" ? (
      <Check />
    ) : d.state === "not_now" ? (
      <Pause />
    ) : d.state === "question" ? (
      <HelpCircle />
    ) : (
      <Clock />
    );
  return (
    <Surface tone="inset" pad="sm" role="status" className="flex flex-col gap-2">
      <p className="flex items-center gap-2 text-body font-semibold text-ink">
        <span aria-hidden className="inline-flex shrink-0 [&>svg]:size-4">
          {icon}
        </span>
        {a(`decState_${d.state}`)}
        {last && <span className="font-normal text-ink-2">· {f.date(last.at, "dayMonth")}</span>}
      </p>
      {last?.text && (
        <p className="text-body text-ink-2">
          {last.author.name}: “{last.text}”
        </p>
      )}
      <Link
        href="/decisions"
        className="focus-ring inline-flex min-h-tap items-center gap-2 self-start rounded-btn text-body font-semibold text-ink underline underline-offset-4"
      >
        <MessageSquare aria-hidden className="size-4" strokeWidth={1.7} />
        {d.state === "question" ? t("ownerReply") : t("ownerOpen")}
      </Link>
    </Surface>
  );
}
