"use client";

import { Button } from "@terrasight/ui";
import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Chat } from "@/components/Chat";
import { api } from "@/lib/api";

/** Assistant panel next to a field (design 08): opens a chat with the field as context (S-05.05). */
export function FieldAssistant({
  workspaceId,
  fieldId,
  fieldName,
}: {
  workspaceId: string;
  fieldId: string;
  fieldName: string;
}) {
  const f = useTranslations("Field");
  const t = useTranslations("App");
  const [id, setId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    try {
      const c = await api<{ id: string }>(`/api/w/${workspaceId}/conversations`, {
        body: { title: fieldName },
      });
      setId(c.id);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-card border border-line bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-h2 text-ink">
          <Sparkles aria-hidden className="size-5" strokeWidth={1.7} />
          {f("ai_name")}
        </h2>
        <span className="text-small text-ink-2">{t("aiContextField", { name: fieldName })}</span>
      </div>
      {id ? (
        <Chat workspaceId={workspaceId} conversationId={id} context={{ fieldId }} compact />
      ) : (
        <Button
          variant="outline"
          icon={<Sparkles />}
          onClick={() => void open()}
          disabled={busy}
          aria-busy={busy}
        >
          {f("bf_ask")}
        </Button>
      )}
    </section>
  );
}
