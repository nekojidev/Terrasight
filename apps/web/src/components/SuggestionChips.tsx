"use client";

import { MessageCircleQuestion } from "lucide-react";
import { useTranslations } from "next-intl";

export interface SuggestedQuestion {
  id: string;
  text: string;
}

export interface SuggestionChipsProps {
  /** 2–3 questions in the farmer's words. */
  questions: SuggestedQuestion[];
  /** The caller decides: fill the composer or navigate to the assistant. */
  onAsk: (q: SuggestedQuestion) => void;
  label?: string;
  className?: string;
}

/** Suggested questions that lead to the assistant: 44 px chips that wrap on a phone. */
export function SuggestionChips({ questions, onAsk, label, className }: SuggestionChipsProps) {
  const t = useTranslations("System");
  if (!questions.length) return null;
  return (
    <ul aria-label={label ?? t("askLabel")} className={`flex flex-wrap gap-2 ${className ?? ""}`} data-testid="suggestion-chips">
      {questions.map((q) => (
        <li key={q.id} className="max-w-full">
          <button
            type="button"
            onClick={() => onAsk(q)}
            className="focus-ring inline-flex min-h-tap max-w-full cursor-pointer items-center gap-2 rounded-chip border border-line-control bg-surface px-4 py-2 text-left text-small font-semibold text-ink hover:bg-muted"
          >
            <MessageCircleQuestion aria-hidden strokeWidth={1.7} className="size-4 shrink-0" />
            <span className="sr-only">{t("ask")}: </span>
            <span className="min-w-0">{q.text}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
