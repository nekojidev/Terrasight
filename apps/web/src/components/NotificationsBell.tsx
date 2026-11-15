"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@terrasight/ui";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useWorkspaceEvents } from "@/lib/events";
import { useFormat } from "@/lib/useFormat";

export interface NotificationItem {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}
interface NotificationList {
  unread: number;
  items: NotificationItem[];
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : 0);

/** Where a notification leads (RFC §15.4): report → /decisions, recommendation → /recommendations/:id, run → /. */
export function notificationHref(n: Pick<NotificationItem, "kind" | "payload">): string {
  if (n.kind === "report_answered" || n.kind === "decision_asked") return "/decisions";
  if (n.kind === "urgent_recommendation") return `/recommendations/${str(n.payload.recommendationId)}`;
  return "/";
}

export interface NotificationGroup {
  key: string;
  first: NotificationItem;
  /** How many identical notifications this row stands for. */
  count: number;
  /** How many of them are unread. */
  unread: number;
  ids: string[];
}

/** Identical notifications (same text and destination) collapse into one row with a count. */
export function groupNotifications(
  items: NotificationItem[],
  textOf: (n: NotificationItem) => string,
): NotificationGroup[] {
  const out = new Map<string, NotificationGroup>();
  for (const n of items) {
    const key = `${textOf(n)}|${notificationHref(n)}`;
    const g = out.get(key);
    const u = n.readAt ? 0 : 1;
    if (g) {
      g.count += 1;
      g.unread += u;
      g.ids.push(n.id);
    } else out.set(key, { key, first: n, count: 1, unread: u, ids: [n.id] });
  }
  return [...out.values()];
}

/** Bell with an unread dot and a small list; the text is built here from kind + payload. */
export function NotificationsBell({ workspaceId }: { workspaceId: string }) {
  const a = useTranslations("App");
  const fmt = useFormat();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const key = ["notifications", workspaceId];

  useWorkspaceEvents(workspaceId, ["notifications"], () => [key]);
  const { data, isError } = useQuery({
    queryKey: key,
    queryFn: () => api<NotificationList>(`/api/w/${workspaceId}/notifications`),
  });
  const read = useMutation({
    mutationFn: (ids?: string[]) =>
      api(`/api/w/${workspaceId}/notifications/read`, { method: "POST", body: ids ? { ids } : {} }),
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const text = (n: NotificationItem): string => {
    const field = str(n.payload.fieldName);
    if (n.kind === "report_answered") {
      const ans = str(n.payload.answer);
      return a(
        ans === "approve" || ans === "done"
          ? "notifAnswerDone"
          : ans === "question"
            ? "notifAnswerQuestion"
            : "notifAnswerNotYet",
        {
          field,
        },
      );
    }
    if (n.kind === "urgent_recommendation") return a("notifUrgent", { field });
    if (n.kind === "decision_asked") return a("notifDecisionAsked", { field });
    if (n.kind === "run_failed")
      return a("notifRunFailed", { failed: num(n.payload.failed), total: num(n.payload.total) });
    return a("notifGeneric");
  };
  const when = (iso: string) => fmt.date(iso, "dateTime");

  const items = data?.items ?? [];
  const groups = groupNotifications(items, text);
  // The badge counts what the list shows as unread, so the two never disagree.
  const unread = groups.reduce((sum, g) => sum + g.unread, 0);

  return (
    <div ref={box} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={unread > 0 ? `${a("notifBell")}, ${a("notifUnreadCount", { n: unread })}` : a("notifBell")}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className="focus-ring relative inline-flex size-11 items-center justify-center rounded-btn border border-line-control bg-surface"
      >
        <Bell aria-hidden className="size-5" strokeWidth={1.7} />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -top-1.5 -right-1.5 inline-flex min-w-5 items-center justify-center rounded-chip bg-urgent px-1 text-caption leading-5 font-semibold text-surface"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={a("notifBell")}
          className="animate-pop absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] origin-top-right rounded-card border border-line bg-surface p-2 shadow-hero"
        >
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <span className="text-body font-semibold text-ink">{a("notifBell")}</span>
            <Button
              variant="link"
              disabled={unread === 0 || read.isPending}
              onClick={() => read.mutate(undefined)}
              className="min-h-tap px-2 text-caption no-underline"
            >
              {a("notifMarkAll")}
            </Button>
          </div>
          {isError ? (
            <p className="px-2 py-4 text-body text-ink-2">{a("notifError")}</p>
          ) : items.length === 0 ? (
            <p className="px-2 py-4 text-body text-ink-2">{a("notifEmpty")}</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {groups.map((g) => {
                const n = g.first;
                const isUnread = g.unread > 0;
                return (
                  <li key={g.key}>
                    <Link
                      href={notificationHref(n)}
                      onClick={() => {
                        const ids = g.ids.filter((id) => items.find((x) => x.id === id && !x.readAt));
                        if (ids.length) read.mutate(ids);
                        setOpen(false);
                      }}
                      className="focus-ring flex min-h-tap items-start gap-2 rounded-btn px-2 py-2 hover:bg-surface-2"
                    >
                      <span
                        aria-hidden
                        className={`mt-2 size-2 shrink-0 rounded-chip ${isUnread ? "bg-urgent" : "bg-transparent"}`}
                      />
                      {isUnread && <span className="sr-only">{a("notifUnread")}</span>}
                      <span className="min-w-0 flex-1">
                        <span className={`block text-body text-ink ${isUnread ? "font-semibold" : ""}`}>{text(n)}</span>
                        <span className="block text-caption text-ink-3">{when(n.createdAt)}</span>
                      </span>
                      {g.count > 1 && (
                        <span className="shrink-0 rounded-chip bg-muted px-2 text-caption font-semibold text-ink">
                          {a("notifCount", { n: g.count })}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
