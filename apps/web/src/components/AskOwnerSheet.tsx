"use client";

import { BottomSheet } from "@terrasight/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

export interface AskPreview {
  fieldName: string;
  title: string;
  action: string;
  /** Already formatted ("by 12 April", "this week"), or empty. */
  deadline?: string;
  numbers: Array<{ label: string; value: string }>;
}

/**
 * "Ask the owner" (PD v2.7): a small sheet showing what the owner will see (title, action, deadline, key numbers),
 * an optional note, and Send. The caller then shows the 8 s Undo row.
 */
export function AskOwnerSheet({
  preview,
  onSend,
  onClose,
}: {
  preview: AskPreview | null;
  onSend: (note: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("App");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (preview) setNote("");
  }, [preview]);
  return (
    <BottomSheet
      open={preview !== null}
      title={t("askTitle")}
      primaryLabel={t("askSend")}
      cancelLabel={t("bsCancel")}
      onClose={onClose}
      onPrimary={() => onSend(note.trim())}
    >
      {preview && (
        <div className="flex flex-col gap-3">
          <p className="text-small text-ink-2">{t("askSub")}</p>
          <div className="flex flex-col gap-1 rounded-input bg-surface-2 p-4">
            <p className="text-small text-ink-2">
              {preview.fieldName}
              {preview.deadline ? ` · ${preview.deadline}` : ""}
            </p>
            <p className="text-body font-semibold text-ink">{preview.title}</p>
            <p className="text-body text-ink">{preview.action}</p>
            {preview.numbers.length > 0 && (
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-small text-ink-2">
                {preview.numbers.map((n) => (
                  <li key={n.label}>
                    <span className="font-mono font-semibold text-ink">{n.value}</span> {n.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <label className="flex flex-col gap-1 text-small text-ink-2">
            {t("askNote")}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              className="focus-ring min-h-20 rounded-input border border-line-strong bg-surface p-3 text-body text-ink"
            />
          </label>
        </div>
      )}
    </BottomSheet>
  );
}
