"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Chip } from "@terrasight/ui";
import { Copy, Link2, RefreshCw, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { OwnerReport, type ReportItem, type ReportView } from "@/components/OwnerReport";
import { api } from "@/lib/api";
import { useWorkspaceEvents } from "@/lib/events";

type Role = "owner" | "admin" | "agronomist" | "viewer";
interface Link {
  id: string;
  language: "en" | "uk";
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Reports (design 15): items with the owner's answers, republish, reply drafts; report links for Owner and Admin. */
export function ReportsClient({
  workspaceId,
  role,
  fieldId,
}: {
  workspaceId: string;
  role: Role;
  fieldId: string | null;
}) {
  const t = useTranslations("App");
  const rs = useTranslations("Reports");
  const locale = useLocale() as "en" | "uk";
  const client = useQueryClient();
  useWorkspaceEvents(workspaceId, ["brief"], () => [["report", workspaceId]]);
  const key = ["report", workspaceId, fieldId];
  const report = useQuery({
    queryKey: key,
    queryFn: () => api<ReportView>(`/api/w/${workspaceId}/report${fieldId ? `?field=${fieldId}` : ""}`),
  });
  const refresh = () => void client.invalidateQueries({ queryKey: ["report", workspaceId] });

  if (!report.data) return <p className="text-body text-ink-2">{report.isError ? t("errGeneric") : "…"}</p>;
  if (role === "viewer") {
    return (
      <div className="mx-auto max-w-[520px]">
        <OwnerReport
          report={report.data}
          onAnswer={async (id, answer, text) => (
            await api(`/api/w/${workspaceId}/report-items/${id}/answers`, {
              body: { answer, ...(text ? { text } : {}) },
            }),
            refresh()
          )}
        />
      </div>
    );
  }
  return (
    <div className="grid gap-8 xl:grid-cols-[1fr_380px]">
      <div className="flex min-w-0 flex-col gap-6">
        <header>
          <h1 className="text-h1 text-ink">{t("rpTitle")}</h1>
          <p className="text-body text-ink-2">{rs("sub")}</p>
        </header>
        {report.data.fields.length === 0 && (
          <p className="rounded-card border border-line bg-surface p-6 text-body text-ink-2">
            {t("rpEmpty")}
          </p>
        )}
        {report.data.fields.map((f) => (
          <section key={f.fieldId} className="flex flex-col gap-3">
            <h2 className="text-h2 text-ink">{f.fieldName}</h2>
            {f.items.map((i) => (
              <ItemRow
                key={i.id}
                item={i}
                workspaceId={workspaceId}
                lang={report.data!.language}
                uiLang={locale}
                onChange={refresh}
              />
            ))}
          </section>
        ))}
      </div>
      <aside className="flex flex-col gap-4">
        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="mb-3 text-body font-semibold text-ink">{rs("preview")}</h2>
          <div className="max-h-[520px] overflow-y-auto">
            <OwnerReport report={report.data} onAnswer={null} />
          </div>
        </section>
        {(role === "owner" || role === "admin") && <Links workspaceId={workspaceId} />}
      </aside>
    </div>
  );
}

function ItemRow({
  item,
  workspaceId,
  lang,
  uiLang,
  onChange,
}: {
  item: ReportItem;
  workspaceId: string;
  lang: "en" | "uk";
  uiLang: "en" | "uk";
  onChange: () => void;
}) {
  const t = useTranslations("App");
  const [draft, setDraft] = useState<{ draft: string; question: { text: string | null } | null } | null>(
    null,
  );
  const [text, setText] = useState("");
  const a = item.latestAnswer;
  const tone = a?.answer === "done" ? "ok" : a?.answer === "question" ? "urgent" : a ? "week" : "neutral";
  async function loadDraft() {
    const d = await api<{ draft: string; question: { text: string | null } | null }>(
      `/api/w/${workspaceId}/report-items/${item.id}/reply-draft`,
      { body: {} },
    );
    setDraft(d);
    setText(d.draft);
  }
  return (
    <article className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-body font-semibold text-ink">{item.text.title[uiLang]}</h3>
        <Chip tone={tone}>
          {a ? `${t(`rpAnswer_${a.answer}`)}${a.via === "link" ? ` · ${t("rpVia")}` : ""}` : t("rpNoAnswer")}
        </Chip>
      </div>
      <p className="text-small text-ink-2">{item.text.action[lang]}</p>
      {a?.answer === "question" && a.text && (
        <p className="rounded-input bg-urgent-soft p-3 text-small text-ink">
          <span className="font-semibold">{t("rpQuestionFrom")}:</span> “{a.text}”
        </p>
      )}
      {item.replies.map((r, k) => (
        <p key={k} className="rounded-input bg-surface-2 p-3 text-small text-ink">
          <span className="font-semibold">{t("rpReplied")}:</span> {r.text}
        </p>
      ))}
      <div className="flex flex-wrap gap-2">
        {item.changedSinceAccepted && (
          <Button
            variant="outline"
            icon={<RefreshCw />}
            onClick={async () => (
              await api(`/api/w/${workspaceId}/report-items/${item.id}/republish`, { body: {} }),
              onChange()
            )}
          >
            {t("rpChanged")} · {t("rpRepublish")}
          </Button>
        )}
        {a?.answer === "question" && !draft && (
          <Button variant="outline" icon={<Sparkles />} onClick={() => void loadDraft()}>
            {t("rpDraft")}
          </Button>
        )}
      </div>
      {draft && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await api(`/api/w/${workspaceId}/report-items/${item.id}/replies`, { body: { text } });
            setDraft(null);
            onChange();
          }}
          className="flex flex-col gap-2"
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-28 rounded-input border border-line-strong bg-surface p-3 text-body"
          />
          <Button type="submit">{t("rpSend")}</Button>
        </form>
      )}
    </article>
  );
}

function Links({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("App");
  const client = useQueryClient();
  const key = ["report-links", workspaceId];
  const links = useQuery({ queryKey: key, queryFn: () => api<Link[]>(`/api/w/${workspaceId}/report-links`) });
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <section className="rounded-card border border-line bg-surface p-5">
      <h2 className="text-body font-semibold text-ink">{t("rpLinks")}</h2>
      <p className="mb-3 text-small text-ink-2">{t("rpLinksSub")}</p>
      <Button
        variant="outline"
        icon={<Link2 />}
        onClick={async () => {
          const l = await api<{ path: string }>(`/api/w/${workspaceId}/report-links`, {
            body: { language: "en" },
          });
          setFresh(`${window.location.origin}${l.path}`);
          void client.invalidateQueries({ queryKey: key });
        }}
      >
        {t("rpNewLink")}
      </Button>
      {fresh && (
        <div className="mt-3 flex flex-col gap-2 rounded-input bg-surface-2 p-3">
          <p className="text-small text-week">{t("rpLinkOnce")}</p>
          <code className="break-all text-micro text-ink">{fresh}</code>
          <Button
            variant="ghost"
            icon={<Copy />}
            onClick={() => void navigator.clipboard.writeText(fresh).then(() => setCopied(true))}
          >
            {copied ? t("rpCopied") : t("rpCopy")}
          </Button>
        </div>
      )}
      <ul className="mt-3 flex flex-col gap-2">
        {(links.data ?? []).map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-2 text-small text-ink-2">
            <span>
              {new Date(l.createdAt).toLocaleDateString()} · {l.language.toUpperCase()}
              {l.revokedAt ? ` · ${t("rpRevoked")}` : ""}
            </span>
            {!l.revokedAt && (
              <Button
                variant="link"
                onClick={async () => (
                  await api(`/api/w/${workspaceId}/report-links/${l.id}`, { method: "DELETE" }),
                  client.invalidateQueries({ queryKey: key })
                )}
              >
                {t("rpRevoke")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
