"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@terrasight/ui";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Chat } from "@/components/Chat";
import { api } from "@/lib/api";

interface Item {
  id: string;
  title: string | null;
  createdAt: string;
}

/** Conversation list + chat (design 14). */
export function AssistantClient({
  workspaceId,
  context,
}: {
  workspaceId: string;
  context: { fieldId?: string; recommendationId?: string };
}) {
  const t = useTranslations("Assistant");
  const app = useTranslations("App");
  const client = useQueryClient();
  const key = ["conversations", workspaceId];
  const list = useQuery({ queryKey: key, queryFn: () => api<Item[]>(`/api/w/${workspaceId}/conversations`) });
  const [current, setCurrent] = useState<string | null>(null);
  const hasContext = Boolean(context.fieldId || context.recommendationId);

  async function start() {
    const c = await api<{ id: string }>(`/api/w/${workspaceId}/conversations`, { body: {} });
    await client.invalidateQueries({ queryKey: key });
    setCurrent(c.id);
  }
  async function remove(id: string) {
    await api(`/api/w/${workspaceId}/conversations/${id}`, { method: "DELETE" });
    if (current === id) setCurrent(null);
    void client.invalidateQueries({ queryKey: key });
  }

  useEffect(() => {
    if (current || !list.data) return;
    if (hasContext || list.data.length === 0) void start();
    else setCurrent(list.data[0]!.id);
  }, [list.data]);

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="flex flex-col gap-3">
        <Button icon={<Plus />} onClick={() => void start()}>
          {t("new")}
        </Button>
        <h2 className="mt-2 font-mono text-small tracking-wide text-ink-2 uppercase">{t("hist")}</h2>
        <ul className="flex flex-col gap-1">
          {(list.data ?? []).map((c) => (
            <li
              key={c.id}
              className={`group flex items-center gap-2 rounded-input px-3 py-2 ${current === c.id ? "bg-muted" : "hover:bg-muted"}`}
            >
              <button
                type="button"
                onClick={() => setCurrent(c.id)}
                className="flex flex-1 items-center gap-2 text-left text-small text-ink"
              >
                <MessageSquare aria-hidden className="size-4 shrink-0 text-ink-3" strokeWidth={1.7} />
                <span className="line-clamp-2">{c.title ?? t("new")}</span>
              </button>
              <button
                type="button"
                aria-label={app("aiDelete")}
                onClick={() => void remove(c.id)}
                className="text-ink-3 opacity-0 group-hover:opacity-100 focus:opacity-100"
              >
                <Trash2 className="size-4" strokeWidth={1.7} />
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="min-w-0 rounded-card border border-line bg-surface p-5">
        {current && (
          <Chat key={current} workspaceId={workspaceId} conversationId={current} context={context} />
        )}
      </section>
    </div>
  );
}
