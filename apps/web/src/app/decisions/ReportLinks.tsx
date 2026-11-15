"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@terrasight/ui";
import { Copy, Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { QueryState } from "@/components/QueryState";
import { useReportError } from "@/components/useReportError";
import { api } from "@/lib/api";

interface ReportLink {
  id: string;
  language: "en" | "uk";
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Report links without an account (Owner only): create (copy-once) and revoke. */
export function ReportLinks({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("App");
  const client = useQueryClient();
  const key = ["report-links", workspaceId];
  const headId = useId();
  const links = useQuery({
    queryKey: key,
    queryFn: () => api<ReportLink[]>(`/api/w/${workspaceId}/report-links`),
  });
  const report = useReportError();
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const body = (
    <>
      <h2 id={headId} className="text-h3 text-ink">
        {t("decLinkTitle")}
      </h2>
      <p className="mb-3 text-small text-ink-2">{t("decLinkSub")}</p>
      <Button
        variant="outline"
        icon={<Link2 />}
        onClick={async () => {
          try {
            const l = await api<{ path: string }>(`/api/w/${workspaceId}/report-links`, {
              body: { language: "en" },
            });
            setFresh(`${window.location.origin}${l.path}`);
            setCopied(false);
            void client.invalidateQueries({ queryKey: key });
          } catch (e) {
            report(e);
          }
        }}
      >
        {t("rpNewLink")}
      </Button>
      {fresh && (
        <div className="mt-3 flex flex-col gap-2 rounded-input bg-surface-2 p-3">
          <p className="text-small text-week">{t("rpLinkOnce")}</p>
          <code className="text-micro break-all text-ink">{fresh}</code>
          <Button
            variant="ghost"
            icon={<Copy />}
            onClick={() => void navigator.clipboard.writeText(fresh).then(() => setCopied(true))}
          >
            {copied ? t("rpCopied") : t("rpCopy")}
          </Button>
        </div>
      )}
      <div className="mt-3">
      <QueryState query={links}>
        {(list) => (
      <ul className="flex flex-col gap-2">
        {list.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-2 text-small text-ink-2">
            <span>
              {new Date(l.createdAt).toLocaleDateString()} · {l.language.toUpperCase()}
              {l.revokedAt ? ` · ${t("rpRevoked")}` : ""}
            </span>
            {!l.revokedAt && (
              <Button
                variant="link"
                onClick={async () => {
                  try {
                    await api(`/api/w/${workspaceId}/report-links/${l.id}`, { method: "DELETE" });
                    await client.invalidateQueries({ queryKey: key });
                  } catch (e) {
                    report(e);
                  }
                }}
              >
                {t("rpRevoke")}
              </Button>
            )}
          </li>
        ))}
      </ul>
        )}
      </QueryState>
      </div>
    </>
  );
  return (
    <section aria-labelledby={headId} className="rounded-card border border-line bg-surface p-5">
      {body}
    </section>
  );
}
