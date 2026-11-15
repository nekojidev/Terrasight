"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Disclosure, Segmented, Surface, TextField, useToast } from "@terrasight/ui";
import { ArchiveRestore, Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { QueryState } from "@/components/QueryState";
import { TimeZoneField } from "@/components/TimeZoneField";
import { api, ApiError } from "@/lib/api";
import { useActionToast } from "@/lib/useActionToast";
import { useFormat } from "@/lib/useFormat";

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
export function WorkspaceSettingsClient({
  workspaceId,
  initial,
}: {
  workspaceId: string;
  initial: Settings;
}) {
  const t = useTranslations("App");
  const o = useTranslations("Onboarding");
  const s = useTranslations("Settings");
  const f = useFormat();
  const toast = useToast();
  const router = useRouter();
  const client = useQueryClient();
  const action = useActionToast();
  const [form, setForm] = useState<Settings>(initial);
  const [error, setError] = useState<ApiError | null>(null);

  const save = useMutation({
    mutationFn: (body: Settings) => api(`/api/w/${workspaceId}`, { method: "PATCH", body }),
    onMutate: () => setError(null),
    onSuccess: () => {
      toast.show(s("companySaved"), "info");
      router.refresh();
    },
    onError: (e, body) => {
      if (e instanceof ApiError && e.problem.status === 422) setError(e);
      else action.fail(e, s("companyFail"), () => save.mutate(body));
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
    mutationFn: (id: string) =>
      api(`/api/w/${workspaceId}/fields/${id}/restore`, { method: "POST", body: {} }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["fields-archived", workspaceId] });
      void client.invalidateQueries({ queryKey: ["fields", workspaceId] });
      router.refresh();
    },
    onError: (e, id) => action.fail(e, s("restoreFail"), () => restore.mutate(id)),
  });

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Surface as="section" aria-labelledby="ws-form">
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
          <TimeZoneField value={form.timeZone} onChange={(timeZone) => setForm({ ...form, timeZone })} />
          <div className="flex flex-col gap-1">
            <Segmented
              label={o("units")}
              value={form.units}
              onChange={(units) => setForm({ ...form, units })}
              options={[
                { value: "metric", label: o("u_ha") },
                { value: "imperial", label: o("u_ac") },
              ]}
            />
            <p className="text-small text-ink-2">{s("setUnitsNote")}</p>
          </div>
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
          <div>
            <Button
              type="submit"
              size={48}
              disabled={save.isPending || !form.name.trim()}
              aria-busy={save.isPending}
            >
              {t("save")}
            </Button>
          </div>
        </form>
      </Surface>

      <Surface as="section" aria-label={t("setExportTitle")}>
        <Disclosure summary={t("setExportTitle")}>
          <p className="mb-4 text-small text-ink-2">{t("setExportSub")}</p>
          <a
            href={`/api/w/${workspaceId}/export`}
            download
            className="focus-ring inline-flex min-h-12 items-center gap-2 rounded-btn border border-line-control bg-surface px-5 text-body font-semibold text-ink hover:bg-surface-2"
          >
            <Download aria-hidden className="size-5" />
            {t("setExportGo")}
          </a>
        </Disclosure>
      </Surface>

      <Surface as="section" aria-labelledby="ws-archived">
        <h2 id="ws-archived" className="mb-1 text-h3 text-ink">
          {t("setArchivedTitle")}
        </h2>
        <p className="mb-4 text-small text-ink-2">{t("setArchivedSub")}</p>
        <QueryState query={archived} skeletonVariant="rows" what={t("setArchivedTitle")}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="text-small text-ink-2">{t("setArchivedEmpty")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {rows.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span className="min-w-0">
                      <span className="block truncate text-body font-semibold text-ink">{row.name}</span>
                      <span className="text-small text-ink-2">
                        {t("setArchivedOn", { date: f.date(row.archivedAt, "full") })}
                      </span>
                    </span>
                    <Button
                      variant="outline"
                      icon={<ArchiveRestore />}
                      disabled={restore.isPending}
                      onClick={() => restore.mutate(row.id)}
                    >
                      {t("setRestore")}
                    </Button>
                  </li>
                ))}
              </ul>
            )
          }
        </QueryState>
      </Surface>
    </div>
  );
}
