"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Button, Chip, Surface, useToast } from "@terrasight/ui";
import { Plus, Send, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";
import { useAssistantAsk } from "@/components/AssistantBus";
import { Chat } from "@/components/Chat";
import { useActiveConversation } from "@/components/useActiveConversation";
import { api, ApiError } from "@/lib/api";
import { useActionToast } from "@/lib/useActionToast";

/**
 * Assistant panel beside a field (design 08, S-05.05): suggestion chips and a question box with the field as context.
 * The conversation is created with the first question, so opening a field never writes anything.
 */
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
  const locale = useLocale();
  const client = useQueryClient();
  const { id, loading, select, forget } = useActiveConversation(workspaceId, fieldId);
  const lang = locale === "uk" ? "uk" : "en";
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const { fail } = useActionToast();
  const toast = useToast();

  async function start(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true);
    let created: string | null = null;
    try {
      // The chat is tied to the field, so coming back to this page finds it; the first question names it.
      const c = await api<{ id: string }>(`/api/w/${workspaceId}/conversations`, { body: { fieldId } });
      created = c.id;
      await api(`/api/w/${workspaceId}/conversations/${c.id}/messages`, {
        body: { text: question, context: { fieldId }, lang },
      });
      select(c.id);
    } catch (e) {
      // Don't leave an empty conversation behind when the question could not be sent.
      if (created)
        void api(`/api/w/${workspaceId}/conversations/${created}`, { method: "DELETE" }).catch(() => undefined);
      setText(question);
      if (e instanceof ApiError && e.problem.status === 429) toast.show(t("aiRateLimited"), "error");
      else fail(e, f("askWhat"), () => void start(question));
    } finally {
      setBusy(false);
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void start(text);
  };
  /** "New chat": an empty thread for this field becomes the one that is restored from now on. */
  async function newChat() {
    if (busy) return;
    setBusy(true);
    try {
      const c = await api<{ id: string }>(`/api/w/${workspaceId}/conversations`, { body: { fieldId } });
      select(c.id);
    } catch (e) {
      fail(e, f("newChatWhat"), () => void newChat());
    } finally {
      setBusy(false);
    }
  }
  const panel = useRef<HTMLDivElement>(null);
  // "Why so?" on the field card asks through the bus instead of poking at this panel's input.
  useAssistantAsk((question) => {
    if (busy) return false;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    panel.current?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" });
    if (!id) {
      void start(question);
      return true;
    }
    // A thread is open: the question goes into it.
    void api(`/api/w/${workspaceId}/conversations/${id}/messages`, {
      body: { text: question, context: { fieldId }, lang },
    })
      .then(() => client.invalidateQueries({ queryKey: ["conversation", workspaceId, id] }))
      .catch((e) => fail(e, f("askWhat")));
    return true;
  });
  const suggestions = [t("faSugg1"), t("faSugg2"), t("faSugg3")];

  return (
    <div ref={panel}>
    <Surface
      as="section"
      aria-label={f("assistantOpen")}
      className={`flex flex-col ${id ? "min-h-[420px]" : ""}`}
      pad="none"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <span className="inline-flex size-10 items-center justify-center rounded-btn bg-ink text-surface">
          <Sparkles aria-hidden className="size-5" strokeWidth={1.7} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold text-ink">{f("ai_name")}</span>
          <span className="text-caption text-ink-2">{t("aiContextField", { name: fieldName })}</span>
        </span>
        {id && (
          <Button
            variant="outline"
            icon={<Plus />}
            onClick={() => void newChat()}
            disabled={busy}
            aria-label={t("aiNewChatFor", { name: fieldName })}
          >
            {t("aiNewChat")}
          </Button>
        )}
        <span className="flex items-center gap-1.5 text-caption font-semibold text-ok">
          <span aria-hidden className="size-2 rounded-full bg-ok" />
          Gemini
        </span>
      </header>
      <div className="flex flex-1 flex-col p-4">
        {loading ? (
          <div aria-busy="true" className="flex-1" />
        ) : id ? (
          <Chat
            key={id}
            workspaceId={workspaceId}
            conversationId={id}
            context={{ fieldId }}
            suggestions={suggestions}
            onMissing={forget}
            compact
          />
        ) : (
          <>
            <p className="text-body text-ink-2">{t("faIntro")}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <Chip key={s} tone="neutral" icon={<Sparkles />} onClick={() => void start(s)}>
                  {s}
                </Chip>
              ))}
            </div>
            <form onSubmit={submit} className="mt-4 flex items-center gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t("faPlaceholder", { name: fieldName })}
                aria-label={t("faPlaceholder", { name: fieldName })}
                className="min-h-tap min-w-0 flex-1 rounded-input border border-line-control bg-surface px-4 text-body"
              />
              <Button type="submit" icon={<Send />} disabled={busy || !text.trim()} aria-busy={busy}>
                {f("send")}
              </Button>
            </form>
            <p className="mt-2 text-caption text-ink-2">{f("disclaimer")}</p>
          </>
        )}
      </div>
    </Surface>
    </div>
  );
}
