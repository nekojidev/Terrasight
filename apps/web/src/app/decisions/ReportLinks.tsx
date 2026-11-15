"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Disclosure, Segmented, Surface, useToast } from "@terrasight/ui";
import { Copy, Link2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { QueryState } from "@/components/QueryState";
import { api, ApiError } from "@/lib/api";
import { useActionToast } from "@/lib/useActionToast";
import { useFormat } from "@/lib/useFormat";

interface ReportLink {
  id: string;
  language: "en" | "uk";
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

type Lang = "uk" | "en";
type Days = "30" | "60";

/**
 * "Link for the owner": a link that opens the owner's decisions without an account. The agronomist picks the language
 * (default: the current UI language) and how long it works (the API accepts an expiry up to a year, default 60 days).
 * The link is shown once; it can be copied and turned off. Renders nothing when the API does not let this role manage
 * links (403).
 */
export function ReportLinks({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("App");
  const rp = useTranslations("Reports");
  const uiLocale = useLocale();
  const f = useFormat();
  const toast = useToast();
  const { fail } = useActionToast();
  const client = useQueryClient();
  const key = ["report-links", workspaceId];
  const headId = useId();
  const links = useQuery({
    queryKey: key,
    queryFn: () => api<ReportLink[]>(`/api/w/${workspaceId}/report-links`),
    retry: (n, e) => !(e instanceof ApiError && e.problem.status === 403) && n < 2,
  });
  const [lang, setLang] = useState<Lang>(uiLocale === "uk" ? "uk" : "en");
  const [days, setDays] = useState<Days>("60");
  const [fresh, setFresh] = useState<{ url: string; until: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (links.error instanceof ApiError && links.error.problem.status === 403) return null;

  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      const expiresAt = new Date(Date.now() + Number(days) * 864e5).toISOString();
      const l = await api<{ path: string; expiresAt: string | null }>(`/api/w/${workspaceId}/report-links`, {
        body: { language: lang, expiresAt },
      });
      setFresh({ url: `${window.location.origin}${l.path}`, until: l.expiresAt ?? expiresAt });
      void client.invalidateQueries({ queryKey: key });
    } catch (e) {
      fail(e, rp("whatCreate"), () => void create());
    } finally {
      setBusy(false);
    }
  };
  const copy = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      toast.show(rp("linkCopied"), "info");
    } catch (e) {
      fail(e, rp("linkCopy"));
    }
  };
  const revoke = async (id: string): Promise<void> => {
    try {
      await api(`/api/w/${workspaceId}/report-links/${id}`, { method: "DELETE" });
      await client.invalidateQueries({ queryKey: key });
    } catch (e) {
      fail(e, rp("whatRevoke"), () => void revoke(id));
    }
  };
  const status = (l: ReportLink): string =>
    l.revokedAt
      ? rp("linkOff")
      : l.expiresAt && new Date(l.expiresAt).getTime() < Date.now()
        ? rp("linkExpired", { date: f.date(l.expiresAt, "full") })
        : l.expiresAt
          ? rp("linkUntil", { date: f.date(l.expiresAt, "full") })
          : "";

  return (
    <Surface as="section" aria-labelledby={headId} pad="sm">
      <Disclosure summary={<h2 id={headId} className="text-body font-semibold">{rp("linkTitle")}</h2>}>
        <div className="flex flex-col gap-4 pt-2 pb-1">
      <p className="text-small text-ink-2">{rp("linkSub")}</p>
      <Segmented<Lang>
        label={rp("linkLang")}
        value={lang}
        onChange={setLang}
        options={[
          { value: "uk", label: rp("lang_uk") },
          { value: "en", label: rp("lang_en") },
        ]}
      />
      <Segmented<Days>
        label={rp("linkExpiry")}
        value={days}
        onChange={setDays}
        options={[
          { value: "30", label: rp("exp_30") },
          { value: "60", label: rp("exp_60") },
        ]}
      />
      <Button variant="outline" icon={<Link2 />} disabled={busy} onClick={() => void create()}>
        {rp("linkCreate")}
      </Button>
      {fresh && (
        <div className="flex flex-col gap-2 rounded-input bg-surface-2 p-3">
          <p className="text-small text-ink-2">{t("rpLinkOnce")}</p>
          <code className="text-caption break-all text-ink">{fresh.url}</code>
          <p className="text-caption text-ink-2">{rp("linkUntil", { date: f.date(fresh.until, "full") })}</p>
          <Button variant="ghost" icon={<Copy />} onClick={() => void copy(fresh.url)}>
            {rp("linkCopy")}
          </Button>
        </div>
      )}
      <QueryState query={links} skeletonVariant="rows" what={rp("whatLinks")}>
        {(list) =>
          list.length === 0 ? (
            <p className="text-small text-ink-2">{rp("linkNone")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {list.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 text-small text-ink-2">
                  <span>
                    {rp(`lang_${l.language}`)} · {status(l)}
                  </span>
                  {!l.revokedAt && (
                    <Button variant="link" className="min-h-tap" onClick={() => void revoke(l.id)}>
                      {t("rpRevoke")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
        </div>
      </Disclosure>
    </Surface>
  );
}
