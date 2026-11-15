"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Plus, Send, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";
import { useAssistantAsk } from "@/components/AssistantBus";
import { Chat } from "@/components/Chat";
import { useActiveConversation } from "@/components/useActiveConversation";
import { api, ApiError } from "@/lib/api";

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
  const [error, setError] = useState<string | null>(null);

  async function start(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true);
    setError(null);
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
      setError(e instanceof ApiError && e.problem.status === 429 ? t("aiRateLimited") : t("errGeneric"));
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
    setError(null);
    try {
      const c = await api<{ id: string }>(`/api/w/${workspaceId}/conversations`, { body: { fieldId } });
      select(c.id);
    } catch {
      setError(t("errGeneric"));
    } finally {
      setBusy(false);
    }
  }
  const panel = useRef<HTMLElement>(null);
  // "Why so?" on the field card asks through the bus instead of poking at this panel's input.
  useAssistantAsk((question) => {
    if (busy) return false;
    panel.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (!id) {
      void start(question);
      return true;
    }
    // A thread is open: the question goes into it.
    void api(`/api/w/${workspaceId}/conversations/${id}/messages`, {
      body: { text: question, context: { fieldId }, lang },
    })
      .then(() => client.invalidateQueries({ queryKey: ["conversation", workspaceId, id] }))
      .catch(() => setError(t("errGeneric")));
    return true;
  });
  const suggestions = [t("faSugg1"), t("faSugg2"), t("faSugg3")];

  return (
    <section ref={panel} className="flex min-h-[560px] flex-col rounded-hero border border-line bg-surface">
      <header className="flex items-center gap-3 border-b border-line p-4">
        <span className="inline-flex size-10 items-center justify-center rounded-btn bg-ink text-surface">
          <Sparkles aria-hidden className="size-5" strokeWidth={1.7} />
        </span>
        <span className="flex-1">
          <span className="block text-body font-semibold text-ink">{f("ai_name")}</span>
          <span className="text-small text-ink-2">{t("aiContextField", { name: fieldName })}</span>
        </span>
        {id && (
          <button
            type="button"
            onClick={() => void newChat()}
            disabled={busy}
            aria-label={t("aiNewChatFor", { name: fieldName })}
            className="focus-ring inline-flex min-h-tap items-center gap-1.5 rounded-btn border border-line-strong px-3 text-small font-semibold text-ink hover:bg-muted disabled:opacity-60"
          >
            <Plus aria-hidden className="size-4" strokeWidth={1.7} />
            {t("aiNewChat")}
          </button>
        )}
        <span className="flex items-center gap-1.5 text-small font-semibold text-ok">
          <span aria-hidden className="size-2 rounded-full bg-ok" />
          Gemini
        </span>
      </header>
      <div className="flex flex-1 flex-col p-4">
        {loading ? (
          <div aria-busy="true" className="flex-1" />
        ) : id ? (
          <>
            <Chat
              key={id}
              workspaceId={workspaceId}
              conversationId={id}
              context={{ fieldId }}
              suggestions={suggestions}
              onMissing={forget}
              compact
            />
            {error && (
              <p role="alert" className="mt-2 text-small text-urgent">
                {error}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-body text-ink-2">{t("faIntro")}</p>
            <div className="mt-4 flex flex-col items-start gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  onClick={() => void start(s)}
                  className="focus-ring inline-flex items-center gap-2 rounded-chip border border-line bg-surface-2 px-3 py-2 text-small font-semibold text-ink hover:bg-muted disabled:opacity-60"
                >
                  <Sparkles aria-hidden className="size-4" strokeWidth={1.7} />
                  {s}
                </button>
              ))}
            </div>
            {error && (
              <p role="alert" className="mt-3 text-small text-urgent">
                {error}
              </p>
            )}
            <form onSubmit={submit} className="mt-auto flex items-center gap-2 pt-6">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t("faPlaceholder", { name: fieldName })}
                aria-label={t("faPlaceholder", { name: fieldName })}
                className="min-h-tap min-w-0 flex-1 rounded-input border border-line-strong bg-surface px-4 text-body"
              />
              <button
                type="submit"
                disabled={busy || !text.trim()}
                aria-label={f("send")}
                aria-busy={busy}
                className="focus-ring inline-flex size-12 items-center justify-center rounded-btn bg-ink text-surface disabled:opacity-50"
              >
                <Send aria-hidden className="size-5" strokeWidth={1.7} />
              </button>
            </form>
            <p className="mt-2 text-micro text-ink-3">{f("disclaimer")}</p>
          </>
        )}
      </div>
    </section>
  );
}
