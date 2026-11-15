"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Chip, InfoHint, SeasonLabel, SelectField, TextField } from "@terrasight/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useReportError } from "@/components/useReportError";

type Source = "confirmed" | "plan" | "estimate" | "regional" | "unknown";
interface Resolved<T> {
  value: T | null;
  source: Source;
}
interface SeasonRecord {
  season: number;
  crop: Resolved<string>;
  sowingDate: Resolved<string>;
  emergenceDate: Resolved<string>;
  tillage: Resolved<string>;
  missing: string[];
}
interface SourceRef {
  title: string;
  url: string | null;
  accessed: string | null;
}
type Tillage = "no_till" | "reduced" | "conventional";
interface Alternative {
  crop: string;
  season: number;
  window: { from: string; to: string };
  status: "open" | "not-yet";
  daysLeft?: number;
  opensInDays?: number;
}
export interface Suggestion {
  season: number;
  crop: string;
  sowing: {
    window: { from: string; to: string } | null;
    best: string | null;
    bestBasis: "typical" | "soil-temp" | "soil-temp-cold" | null;
    source: SourceRef | null;
    verified: boolean;
    status: "open" | "not-yet" | "late" | "closed" | "unknown";
    daysLeft?: number;
    opensInDays?: number;
  };
  emergence: {
    date: string;
    method: "gdd-observed" | "gdd-forecast" | "gdd-climatology" | "typical-days";
    gdd: number | null;
    source: SourceRef | null;
    verified: boolean;
  } | null;
  tillage: {
    value: Tillage;
    reason: string;
    reasonCode: "slope-high" | "slope-moderate" | "regional-practice" | "gentle-slope";
    params: { slopePct?: number; practice?: Tillage };
    rusle: number | null;
    source: SourceRef | null;
    verified: boolean;
  } | null;
  alternatives?: Alternative[];
}

export interface PlannerHistory {
  cropNames: Record<string, { en: string; uk: string }>;
  regionCrops?: string[];
  seasons: Array<{ season: number; mainCrop: string }>;
}

const TILLAGE: Tillage[] = ["conventional", "reduced", "no_till"];

/** "10 Oct" / "10 жовт." for an ISO date, in the viewer's language. */
export function shortDate(iso: string, locale: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * This season (design 08): the agronomist picks the crop; the app recommends the sowing date, emergence date and
 * tillage, each editable. Untouched recommendations are saved with their origin (regional / estimate), edited ones
 * as confirmed (RFC §6.4, S-02.08).
 */
export function SeasonPlanner({
  base,
  canEdit,
  history,
  workspaceId,
  fieldId,
}: {
  base: string;
  canEdit: boolean;
  history: PlannerHistory;
  workspaceId: string;
  fieldId: string;
}) {
  const record = useQuery({
    queryKey: ["field", workspaceId, fieldId, "season"],
    queryFn: () => api<SeasonRecord>(`${base}/season-records/current`),
  });
  if (!record.data) return null;
  return (
    <PlannerForm
      key={record.data.season}
      base={base}
      canEdit={canEdit}
      history={history}
      record={record.data}
      workspaceId={workspaceId}
      fieldId={fieldId}
    />
  );
}

function PlannerForm({
  base,
  canEdit,
  history,
  record,
  workspaceId,
  fieldId,
}: {
  base: string;
  canEdit: boolean;
  history: PlannerHistory;
  record: SeasonRecord;
  workspaceId: string;
  fieldId: string;
}) {
  const t = useTranslations("App");
  const locale = useLocale();
  const client = useQueryClient();
  const report = useReportError();
  const [saved, setSaved] = useState(false);

  const name = (id: string) => {
    const n = history.cropNames[id];
    return n ? (locale === "uk" ? n.uk : n.en) : id;
  };
  // Last year's crop, only as a labelled suggestion.
  const lastCrop =
    [...history.seasons]
      .filter((s) => s.season < record.season && history.cropNames[s.mainCrop])
      .sort((a, b) => b.season - a.season)[0]?.mainCrop ?? null;
  const saved0 =
    record.crop.value && ["confirmed", "plan"].includes(record.crop.source) ? record.crop.value : null;
  const [crop, setCrop] = useState<string>(saved0 ?? lastCrop ?? "");
  const [touched, setTouched] = useState(false);
  const cropOrigin: "confirmed" | "plan" | "last" | "picked" | null = !crop
    ? null
    : crop === saved0
      ? (record.crop.source as "confirmed" | "plan")
      : !touched && crop === lastCrop
        ? "last"
        : "picked";

  const confirmed = (r: Resolved<string>) => (r.source === "confirmed" ? r.value : null);
  const [sowingEdit, setSowingEdit] = useState<string | null>(confirmed(record.sowingDate));
  const [emergenceEdit, setEmergenceEdit] = useState<string | null>(confirmed(record.emergenceDate));
  const [tillageEdit, setTillageEdit] = useState<Tillage | null>(confirmed(record.tillage) as Tillage | null);

  const dateOk = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const suggest = useQuery({
    queryKey: ["field", workspaceId, fieldId, "suggest", record.season, crop, dateOk(sowingEdit)],
    enabled: !!crop,
    staleTime: 5 * 60_000,
    retry: false,
    placeholderData: (prev) => prev,
    queryFn: () =>
      api<Suggestion>(
        `${base}/season-records/${record.season}/suggest?crop=${encodeURIComponent(crop)}${
          dateOk(sowingEdit) ? `&sowing=${dateOk(sowingEdit)}` : ""
        }`,
      ),
  });
  const sug = suggest.data && suggest.data.crop === crop ? suggest.data : null;

  const pickCrop = (id: string) => {
    setCrop(id);
    setTouched(true);
    setSowingEdit(null);
    setEmergenceEdit(null);
    setTillageEdit(null);
    setSaved(false);
  };

  const sowing = sowingEdit ?? sug?.sowing.best ?? null;
  const emergence = emergenceEdit ?? sug?.emergence?.date ?? null;
  const tillage = tillageEdit ?? sug?.tillage?.value ?? null;

  const save = useMutation({
    onError: report,
    mutationFn: () => {
      const sources: Record<string, string> = {};
      if (cropOrigin === "plan") sources.crop = "plan";
      if (sowing && !sowingEdit)
        sources.sowingDate = sug?.sowing.bestBasis === "soil-temp" ? "estimate" : "regional";
      if (emergence && !emergenceEdit) sources.emergenceDate = "estimate";
      if (tillage && !tillageEdit) sources.tillage = "estimate";
      return api<SeasonRecord>(`${base}/season-records/${record.season}`, {
        method: "PUT",
        body: {
          crop: crop || null,
          ...(sowing ? { sowingDate: sowing } : {}),
          ...(emergence ? { emergenceDate: emergence } : {}),
          ...(tillage ? { tillage } : {}),
          sources,
        },
      });
    },
    onSuccess: (r) => {
      client.setQueryData(["field", workspaceId, fieldId, "season"], r);
      setSaved(true);
    },
  });

  const cropIds = (history.regionCrops?.length ? history.regionCrops : Object.keys(history.cropNames)).filter(
    (id) => id !== "fallow",
  );
  if (crop && !cropIds.includes(crop)) cropIds.push(crop);
  const options = [
    { value: "", label: t("spCropPlaceholder") },
    ...cropIds
      .map((id) => ({ value: id, label: name(id) }))
      .sort((a, b) => a.label.localeCompare(b.label, locale)),
  ];

  const missing = record.missing.map((k) => (t.has(`miss_${k}`) ? t(`miss_${k}`) : k));
  const d = (iso: string) => shortDate(iso, locale);
  const sw = sug?.sowing;

  return (
    <section className="rounded-card border border-line bg-surface p-5">
      <h2 className="text-h2 text-ink">
        {t("seasonTitle")} ·{" "}
        <SeasonLabel
          year={record.season}
          hintLabel={t("hintLabel")}
          hintTemplate={`${t("hintSeason")} ${t("hintSeasonNow")}`}
        />
      </h2>

      <div className="mt-4 grid gap-5">
        {/* Step 1: the crop */}
        <div className="max-w-md">
          <SelectField
            label={t("spCropStep")}
            name="crop"
            options={options}
            value={crop}
            onChange={(e) => pickCrop(e.target.value)}
            hint={
              cropOrigin === "last"
                ? t("spCropFromLast", { crop: name(crop) })
                : cropOrigin === "plan"
                  ? t("spCropFromPlan")
                  : cropOrigin === "confirmed"
                    ? t("spCropConfirmed")
                    : undefined
            }
            disabled={!canEdit}
          />
          <Why>{t("spCropWhy")}</Why>
        </div>

        {crop && suggest.isPending && <p className="text-small text-ink-2">{t("spLoading")}</p>}
        {crop && suggest.isError && !sug && <p className="text-small text-week">{t("spSuggestFailed")}</p>}

        {sw && (
          <Banner
            sug={sug!}
            name={name}
            d={d}
            season={record.season}
            onPick={canEdit ? pickCrop : undefined}
          />
        )}

        {crop && (sug || sowingEdit || suggest.isError) && (
          <div className="grid gap-5 md:grid-cols-3">
            <ValueBlock
              title={t("sowing")}
              why={t("spSowingWhy")}
              estimate={sw ? !sw.verified && !sowingEdit : false}
              recommended={sw?.best ? d(sw.best) : null}
              detail={
                sw?.window
                  ? [
                      t("spWindow", { from: d(sw.window.from), to: d(sw.window.to) }),
                      sw.bestBasis && sw.bestBasis !== "typical"
                        ? t(`spBest_${sw.bestBasis.replace("-", "_")}`)
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : t("spNoCalendar")
              }
              source={sw?.source}
              edited={!!sowingEdit}
              canEdit={canEdit}
              onReset={() => setSowingEdit(null)}
              editor={
                <TextField
                  label={t("sowing")}
                  type="date"
                  value={sowingEdit ?? sw?.best ?? ""}
                  onChange={(e) => {
                    setSowingEdit(e.target.value || null);
                    setEmergenceEdit(null);
                    setSaved(false);
                  }}
                  disabled={!canEdit}
                />
              }
              onEdit={() => setSowingEdit(sw?.best ?? new Date().toISOString().slice(0, 10))}
              editedValue={sowingEdit ? d(sowingEdit) : null}
            />
            <ValueBlock
              title={t("emergence")}
              why={t("spEmergenceWhy")}
              estimate={sug?.emergence ? !emergenceEdit : false}
              recommended={sug?.emergence ? d(sug.emergence.date) : null}
              detail={
                sug?.emergence
                  ? t(`spMethod_${sug.emergence.method.replaceAll("-", "_")}`, {
                      gdd: sug.emergence.gdd ?? 0,
                    })
                  : sowing
                    ? t("spNoEmergence")
                    : t("spEmergenceNeedsSowing")
              }
              source={sug?.emergence?.source}
              edited={!!emergenceEdit}
              canEdit={canEdit}
              onReset={() => setEmergenceEdit(null)}
              editor={
                <TextField
                  label={t("emergence")}
                  type="date"
                  value={emergenceEdit ?? sug?.emergence?.date ?? ""}
                  onChange={(e) => {
                    setEmergenceEdit(e.target.value || null);
                    setSaved(false);
                  }}
                  disabled={!canEdit}
                />
              }
              onEdit={() =>
                setEmergenceEdit(sug?.emergence?.date ?? sowing ?? new Date().toISOString().slice(0, 10))
              }
              editedValue={emergenceEdit ? d(emergenceEdit) : null}
            />
            <ValueBlock
              title={t("tillage")}
              why={t("spTillageWhy")}
              estimate={sug?.tillage ? !tillageEdit : false}
              recommended={sug?.tillage ? t(`till_${sug.tillage.value}`) : null}
              detail={sug?.tillage ? tillageReason(t, sug.tillage) : t("spNoTillage")}
              source={sug?.tillage?.source}
              edited={!!tillageEdit}
              canEdit={canEdit}
              onReset={() => setTillageEdit(null)}
              editor={
                <SelectField
                  label={t("tillage")}
                  options={TILLAGE.map((v) => ({ value: v, label: t(`till_${v}`) }))}
                  value={tillageEdit ?? sug?.tillage?.value ?? "conventional"}
                  onChange={(e) => {
                    setTillageEdit(e.target.value as Tillage);
                    setSaved(false);
                  }}
                  disabled={!canEdit}
                />
              }
              onEdit={() => setTillageEdit(sug?.tillage?.value ?? "conventional")}
              editedValue={tillageEdit ? t(`till_${tillageEdit}`) : null}
            />
          </div>
        )}

        {missing.length > 0 && (
          <p className="text-small text-week">{t("missing", { list: missing.join(", ") })}</p>
        )}
        {canEdit && (
          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={() => {
                setSaved(false);
                save.mutate();
              }}
              disabled={save.isPending || !crop}
              aria-busy={save.isPending}
            >
              {t("save")}
            </Button>
            {saved && (
              <span role="status" className="text-small text-ok">
                {t("saved")}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function tillageReason(
  t: ReturnType<typeof useTranslations>,
  till: NonNullable<Suggestion["tillage"]>,
): string {
  const code = till.reasonCode.replaceAll("-", "_");
  if (till.reasonCode === "regional-practice")
    return t(
      till.params.slopePct === undefined ? "spTill_regional_practice_noslope" : "spTill_regional_practice",
      {
        slopePct: till.params.slopePct ?? 0,
        practice: t(`till_${till.params.practice ?? till.value}`).toLowerCase(),
      },
    );
  return t(`spTill_${code}`, { slopePct: till.params.slopePct ?? 0 });
}

/** One line under a field saying why the value matters. */
function Why({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-small text-ink-2">{children}</p>;
}

/** Window status against today, with the crops that can still be sown when it is too late. */
function Banner({
  sug,
  name,
  d,
  season,
  onPick,
}: {
  sug: Suggestion;
  name: (id: string) => string;
  d: (iso: string) => string;
  season: number;
  onPick: ((crop: string) => void) | undefined;
}) {
  const t = useTranslations("App");
  const s = sug.sowing;
  if (s.status === "unknown")
    return <p className="rounded-input bg-surface-2 p-3 text-small text-ink-2">{t("spNoCalendar")}</p>;
  const w = s.window!;
  const crop = name(sug.crop);
  if (s.status === "open")
    return (
      <p role="status" className="rounded-input bg-ok-soft p-3 text-small font-semibold text-ok">
        {t("spOpen", { until: d(w.to), days: s.daysLeft ?? 0 })}
      </p>
    );
  if (s.status === "not-yet")
    return (
      <p role="status" className="rounded-input bg-info-soft p-3 text-small font-semibold text-info">
        {t("spNotYet", { from: d(w.from), days: s.opensInDays ?? 0 })}
      </p>
    );
  const alts = sug.alternatives ?? [];
  return (
    <div role="status" className="rounded-input bg-week-soft p-3 text-small text-week">
      <p className="font-semibold">{t("spLate", { crop, to: d(w.to) })}</p>
      {alts.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span>{t("spAltIntro")}</span>
          {alts.map((a) => {
            const label =
              (a.status === "open"
                ? t("spAltOpen", { crop: name(a.crop), to: d(a.window.to) })
                : t("spAltSoon", { crop: name(a.crop), from: d(a.window.from) })) +
              (a.season !== season ? t("spAltForSeason", { season: a.season }) : "");
            return onPick && a.season === season ? (
              <button
                key={`${a.crop}-${a.season}`}
                type="button"
                onClick={() => onPick(a.crop)}
                className="focus-ring rounded-chip bg-surface px-3 py-1 text-small font-semibold text-ink hover:bg-surface-2"
              >
                {label}
              </button>
            ) : (
              <span
                key={`${a.crop}-${a.season}`}
                className="rounded-chip bg-surface px-3 py-1 font-semibold text-ink"
              >
                {label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ValueBlock({
  title,
  why,
  estimate,
  recommended,
  detail,
  source,
  edited,
  editedValue,
  canEdit,
  editor,
  onEdit,
  onReset,
}: {
  title: string;
  why: string;
  estimate: boolean;
  recommended: string | null;
  detail: string;
  source: SourceRef | null | undefined;
  edited: boolean;
  editedValue: string | null;
  canEdit: boolean;
  editor: ReactNode;
  onEdit: () => void;
  onReset: () => void;
}) {
  const t = useTranslations("App");
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-input border border-line p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-small font-semibold text-ink">{title}</h3>
        {source && (
          <InfoHint label={t("hintLabel")}>
            {t("spSource", { source: source.title })}
            {estimate && <span className="mt-1 block">{t("spUnverifiedNote")}</span>}
          </InfoHint>
        )}
        {estimate && <Chip tone="week">{t("spEstimate")}</Chip>}
      </div>
      {edited ? (
        <>
          <p className="text-h3 text-ink">{editedValue}</p>
          <p className="text-small text-ink-2">{t("spYourValue")}</p>
          {canEdit && editor}
          {canEdit && recommended && (
            <Button type="button" variant="link" onClick={onReset} className="self-start text-small">
              {t("spUseRecommended")}: {recommended}
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="text-h3 text-ink">{recommended ?? "—"}</p>
          <p className="text-small text-ink-2">{detail}</p>
          {canEdit && (
            <Button type="button" variant="link" onClick={onEdit} className="self-start text-small">
              {t("spEdit")}
            </Button>
          )}
        </>
      )}
      <p className="mt-auto pt-1 text-small text-ink-3">{why}</p>
    </div>
  );
}
