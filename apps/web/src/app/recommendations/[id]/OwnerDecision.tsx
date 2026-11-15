"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Decision, DecisionAnswer, DecisionList } from "@terrasight/shared";
import { Button, Surface } from "@terrasight/ui";
import { Check, Clock, HelpCircle, MessageCircleQuestion, Pause } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/api";
import { useWorkspaceEvents } from "@/lib/events";
import { useActionToast } from "@/lib/useActionToast";
import { useFormat } from "@/lib/useFormat";

/**
 * The Owner's view of this item (open question 24, option A): when the agronomist asked, the Owner answers right
 * here (Approve / Not now / Ask a question), with the same calls the Decisions page makes. Nothing is shown when no
 * decision is waiting on this item: the Owner just reads it.
 */
export function OwnerDecision({ workspaceId, recommendationId }: { workspaceId: string; recommendationId: string }) {
  const t = useTranslations("Rec");
  const a = useTranslations("App");
  const f = useFormat();
  const client = useQueryClient();
  const { fail } = useActionToast();
  const key = ["decisions", workspaceId, "all"];
  useWorkspaceEvents(workspaceId, ["brief"], () => [["decisions", workspaceId]]);
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<DecisionList>(`/api/w/${workspaceId}/decisions?state=all`),
    retry: false,
  });
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState("");
  const d = list.data?.items.find((i) => i.recommendationId === recommendationId);
  if (!d) return null;

  async function send(kind: DecisionAnswer, note?: string) {
    if (busy) return;
    setBusy(true);
    try {
      await api<Decision>(`/api/w/${workspaceId}/decisions/${d!.id}/answer`, {
        body: { answer: kind, ...(note ? { text: note } : {}) },
      });
      setLive(
        kind === "approve" ? a("odLiveApproved") : kind === "not_now" ? a("odLiveNotNow") : a("odLiveAsked"),
      );
      setAsking(false);
      setText("");
      await client.invalidateQueries({ queryKey: key });
    } catch (e) {
      fail(e, a(`odBtn_${kind}`), () => void send(kind, note));
    } finally {
      setBusy(false);
    }
  }

  const open = d.state === "waiting" || d.state === "question";
  const last = [...d.thread].reverse().find((e) => e.kind === "answer");
  const icon =
    d.state === "approved" ? <Check /> : d.state === "not_now" ? <Pause /> : d.state === "question" ? <HelpCircle /> : <Clock />;
  const stamp = last ? f.date(last.at, "dayMonth") : "";

  return (
    <Surface tone="inset" pad="md" className="flex flex-col gap-3" aria-labelledby="owner-decision-t">
      <h2 id="owner-decision-t" className="text-h3 text-ink">
        {t("owner_decision_t")}
      </h2>
      <p role="status" aria-live="polite" className="sr-only">
        {live}
      </p>
      {!open && (
        <p className="flex items-center gap-2 text-body font-semibold text-ink">
          <span aria-hidden className="inline-flex shrink-0 [&>svg]:size-4">
            {icon}
          </span>
          {d.state === "approved"
            ? a("odYouApproved", { date: stamp })
            : d.state === "not_now"
              ? a("odYouNotNow", { date: stamp })
              : a(`decState_${d.state}`)}
        </p>
      )}
      {d.state === "question" && <p className="text-body text-ink-2">{a("odYouAsked")}</p>}
      {asking ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void send("question", text.trim());
          }}
        >
          <label className="flex flex-col gap-1 text-small text-ink-2">
            {t("owner_q_label")}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
              maxLength={1000}
              className="focus-ring min-h-24 rounded-input border border-line-strong bg-surface p-3 text-body text-ink"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || !text.trim()}>
              {t("owner_q_send")}
            </Button>
            <Button variant="ghost" onClick={() => setAsking(false)}>
              {t("owner_cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2 max-sm:sticky max-sm:bottom-[calc(var(--ts-tabbar)+0.5rem)] max-sm:z-10 max-sm:rounded-card max-sm:bg-surface max-sm:p-2 max-sm:shadow-hero">
          {(
            <>
              <Button icon={<Check />} disabled={busy} onClick={() => void send("approve")}>
                {a("odBtn_approve")}
              </Button>
              <Button variant="outline" icon={<Pause />} disabled={busy} onClick={() => void send("not_now")}>
                {a("odBtn_not_now")}
              </Button>
              <Button variant="outline" icon={<MessageCircleQuestion />} disabled={busy} onClick={() => setAsking(true)}>
                {t("owner_ask_q")}
              </Button>
            </>
          )}
        </div>
      )}
    </Surface>
  );
}
