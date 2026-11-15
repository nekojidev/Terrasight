"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Segmented, SelectField, TextField } from "@terrasight/ui";
import { ArchiveRestore, Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import { QueryState } from "@/components/QueryState";
import { useErrorText, useReportError } from "@/components/useReportError";
import { api, ApiError } from "@/lib/api";
import { zoneLabel } from "@/lib/time-zone";

interface Settings {
  name: string;
  timeZone: string;
  units: "metric" | "imperial";
  reportLanguage: "uk" | "en";
}
interface ArchivedField {
  id: string;
  name: string;
  areaHa: number;
  countyName: string | null;
  archivedAt: string;
}

/** Owner: company settings, a data export and the archived fields (restore). */
export function WorkspaceSettingsClient({ workspaceId, initial }: { workspaceId: string; initial: Settings }) {
  const t = useTranslations("App");
  const o = useTranslations("Onboarding");
  const locale = useLocale();
  const router = useRouter();
  const client = useQueryClient();
  const report = useReportError();
  const errorText = useErrorText();
  const [form, setForm] = useState<Settings>(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const zones = useMemo(() => {
    const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return Array.from(new Set([initial.timeZone, ...all, "UTC"]));
  }, [initial.timeZone]);

  const save = useMutation({
    mutationFn: (body: Settings) => api(`/api/w/${workspaceId}`, { method: "PATCH", body }),
    onMutate: () => {
      setSaved(false);
      setError(null);
    },
    onSuccess: () => {
      setSaved(true);
      router.refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.problem.status === 422) setError(e);
      else report(e);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ ...form, name: form.name.trim() });
  };

  const archived = useQuery({
    queryKey: ["fields-archived", workspaceId],
    queryFn: () => api<ArchivedField[]>(`/api/w/${workspaceId}/fields/archived`),
  });
  const restore = useMutation({
    mutationFn: (id: string) => api(`/api/w/${workspaceId}/fields/${id}/restore`, { method: "POST", body: {} }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["fields-archived", workspaceId] });
      void client.invalidateQueries({ queryKey: ["fields", workspaceId] });
      router.refresh();
    },
    onError: report,
  });
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
      <section aria-labelledby="ws-form" className="h-fit rounded-card border border-line bg-surface p-5">
        <h2 id="ws-form" className="mb-1 text-h3 text-ink">
          {t("setWorkspaceTitle")}
        </h2>
        <p className="mb-4 text-small text-ink-2">{t("setWorkspaceSub")}</p>
        <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
          <TextField
            label={o("name")}
            name="name"
            required
            maxLength={80}
            autoComplete="organization"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={error?.field("name")}
          />
          <SelectField
            label={o("tz")}
            value={form.timeZone}
            onChange={(e) => setForm({ ...form, timeZone: e.target.value })}
            options={zones.map((z) => ({ value: z, label: zoneLabel(z, locale) }))}
          />
          <Segmented
            label={o("units")}
            value={form.units}
            onChange={(units) => setForm({ ...form, units })}
            options={[
              { value: "metric", label: o("u_ha") },
              { value: "imperial", label: o("u_ac") },
            ]}
          />
          <Segmented
            variant="compact"
            label={o("lang")}
            value={form.reportLanguage}
            onChange={(reportLanguage) => setForm({ ...form, reportLanguage })}
            options={[
              { value: "uk", label: "UA" },
              { value: "en", label: "EN" },
            ]}
          />
          {error && !error.field("name") && (
            <p role="alert" className="text-small text-urgent">
              {errorText(error)}
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button type="submit" size={48} disabled={save.isPending || !form.name.trim()} aria-busy={save.isPending}>
              {t("save")}
            </Button>
            {saved && (
              <span role="status" className="text-small text-ok">
                {t("saved")}
              </span>
            )}
          </div>
        </form>
      </section>

      <div className="flex min-w-0 flex-col gap-6">
        <section aria-labelledby="ws-export" className="rounded-card border border-line bg-surface p-5">
          <h2 id="ws-export" className="mb-1 text-h3 text-ink">
            {t("setExportTitle")}
          </h2>
          <p className="mb-4 text-small text-ink-2">{t("setExportSub")}</p>
          <a
            href={`/api/w/${workspaceId}/export`}
            download
            className="focus-ring inline-flex h-12 items-center gap-2 rounded-btn border border-line-strong bg-surface px-5 text-body font-semibold text-ink hover:bg-surface-2"
          >
            <Download aria-hidden className="size-5" />
            {t("setExportGo")}
          </a>
        </section>

        <section aria-labelledby="ws-archived" className="rounded-card border border-line bg-surface p-5">
          <h2 id="ws-archived" className="mb-1 text-h3 text-ink">
            {t("setArchivedTitle")}
          </h2>
          <p className="mb-4 text-small text-ink-2">{t("setArchivedSub")}</p>
          <QueryState query={archived}>
            {(rows) =>
              rows.length === 0 ? (
                <p className="text-small text-ink-2">{t("setArchivedEmpty")}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {rows.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <span className="min-w-0">
                        <span className="block truncate text-body font-semibold text-ink">{f.name}</span>
                        <span className="text-small text-ink-2">
                          {t("setArchivedOn", { date: day(f.archivedAt) })}
                        </span>
                      </span>
                      <Button
                        variant="outline"
                        icon={<ArchiveRestore />}
                        disabled={restore.isPending}
                        onClick={() => restore.mutate(f.id)}
                      >
                        {t("setRestore")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )
            }
          </QueryState>
        </section>
      </div>
    </div>
  );
}
