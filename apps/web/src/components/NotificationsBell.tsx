"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useWorkspaceEvents } from "@/lib/events";

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
  if (n.kind === "report_answered") return "/decisions";
  if (n.kind === "urgent_recommendation") return `/recommendations/${str(n.payload.recommendationId)}`;
  return "/";
}

/** Bell with an unread dot and a small list; the text is built here from kind + payload. */
export function NotificationsBell({ workspaceId }: { workspaceId: string }) {
  const a = useTranslations("App");
  const locale = useLocale();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
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
      if (e.key === "Escape") setOpen(false);
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
    if (n.kind === "run_failed")
      return a("notifRunFailed", { failed: num(n.payload.failed), total: num(n.payload.total) });
    return a("notifGeneric");
  };
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));

  const unread = data?.unread ?? 0;
  const items = data?.items ?? [];

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={a("notifBell")}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="focus-ring relative inline-flex size-11 items-center justify-center rounded-btn border border-line bg-surface"
      >
        <Bell aria-hidden className="size-5" strokeWidth={1.7} />
        {unread > 0 && <span className="absolute top-2.5 right-2.5 size-2 rounded-chip bg-urgent" />}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={a("notifBell")}
          className="absolute right-0 z-20 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-card border border-line bg-surface p-2"
        >
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <span className="text-body font-semibold text-ink">{a("notifBell")}</span>
            <button
              type="button"
              disabled={unread === 0 || read.isPending}
              onClick={() => read.mutate(undefined)}
              className="focus-ring min-h-tap rounded-btn px-2 text-small font-semibold text-ink-2 hover:bg-surface-2 disabled:opacity-50"
            >
              {a("notifMarkAll")}
            </button>
          </div>
          {isError ? (
            <p className="px-2 py-4 text-small text-ink-2">{a("notifError")}</p>
          ) : items.length === 0 ? (
            <p className="px-2 py-4 text-small text-ink-2">{a("notifEmpty")}</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={notificationHref(n)}
                    onClick={() => {
                      if (!n.readAt) read.mutate([n.id]);
                      setOpen(false);
                    }}
                    className="focus-ring flex items-start gap-2 rounded-btn px-2 py-2 hover:bg-surface-2"
                  >
                    <span
                      aria-hidden
                      className={`mt-2 size-2 shrink-0 rounded-chip ${n.readAt ? "bg-transparent" : "bg-urgent"}`}
                    />
                    <span className="min-w-0">
                      <span className={`block text-small text-ink ${n.readAt ? "" : "font-semibold"}`}>
                        {text(n)}
                      </span>
                      <span className="block text-small text-ink-3">{when(n.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
