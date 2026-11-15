"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Chip, SeasonLabel, SelectField, Skeleton, Surface, TextField } from "@terrasight/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useActionToast } from "@/lib/useActionToast";
import { useFormat } from "@/lib/useFormat";
import { fieldFormatOptions } from "./fieldFormat";
import { LandBanner, LandBlocked, type LandView } from "@/components/LandSuitability";
import {
  deriveStage,
  emergenceDefault,
  emergencePromptDue,
  markSownDefault,
  nextStep,
  snoozeUntil,
  todayIso,
} from "./seasonStage";

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
  /** Land suitability of the field: "unsuitable" (not overridden) switches the crop choice off. */
  suitability?: LandView | null;
}

const TILLAGE: Tillage[] = ["conventional", "reduced", "no_till"];

/**
 * This season, by stage (design 08): Planned (pick the crop, plan the sowing), Sown (sowing confirmed, emergence
 * expected), Emerged. One next step at a time. Untouched recommendations are saved with their origin (regional /
 * estimate), values the agronomist types or confirms as `confirmed` (RFC §6.4, S-02.08).
 */
export function SeasonPlanner({
  base,
  canEdit,
  history,
  workspaceId,
  fieldId,
  country,
  units = "metric",
}: {
  base: string;
  canEdit: boolean;
  history: PlannerHistory;
  workspaceId: string;
  fieldId: string;
  country?: string | null;
  units?: "metric" | "imperial";
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
      country={country}
      units={units}
    />
  );
}

type Editing = "crop" | "sowing" | "emergence" | "tillage" | null;
type Body = Partial<{
  crop: string | null;
  sowingDate: string | null;
  emergenceDate: string | null;
  tillage: Tillage | null;
  sources: Record<string, string>;
}>;

const snoozeKey = (fieldId: string, season: number) => `ts-emergence-snooze:${fieldId}:${season}`;
function readSnooze(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeSnooze(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // Private mode: the prompt just returns on the next visit.
  }
}

function PlannerForm({
  base,
  canEdit,
  history,
  record,
  workspaceId,
  fieldId,
  country,
  units,
}: {
  base: string;
  canEdit: boolean;
  history: PlannerHistory;
  record: SeasonRecord;
  workspaceId: string;
  fieldId: string;
  country: string | null | undefined;
  units: "metric" | "imperial";
}) {
  const t = useTranslations("App");
  const f = useTranslations("Field");
  const locale = useLocale();
  const fmt = useFormat(fieldFormatOptions(country, units));
  const client = useQueryClient();
  const { fail } = useActionToast();
  const [today] = useState(() => todayIso());
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [draft, setDraft] = useState("");
  const [markingSown, setMarkingSown] = useState(false);
  const [sownDraft, setSownDraft] = useState("");
  const [askEarly, setAskEarly] = useState(false);
  const [emergenceDraft, setEmergenceDraft] = useState<string | null>(null);
  const snoozeStore = snoozeKey(fieldId, record.season);
  const [snoozedUntil, setSnoozedUntil] = useState<string | null>(() => readSnooze(snoozeStore));

  const name = (id: string) => {
    const n = history.cropNames[id];
    return n ? (locale === "uk" ? n.uk : n.en) : id;
  };
  const d = (iso: string) => fmt.date(`${iso}T00:00:00Z`, "dayMonth", { timeZone: "UTC" });

  const stage = deriveStage(record);
  const planning = stage === "planned";
  const confirmedOf = (r: Resolved<string>) => (r.source === "confirmed" ? r.value : null);

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

  const [sowingEdit, setSowingEdit] = useState<string | null>(
    record.sowingDate.source === "plan" ? record.sowingDate.value : null,
  );
  const [tillageEdit, setTillageEdit] = useState<Tillage | null>(
    ["confirmed", "plan"].includes(record.tillage.source) ? (record.tillage.value as Tillage | null) : null,
  );

  // After sowing, recommendations follow the saved crop and the confirmed sowing date.
  const sownDate = confirmedOf(record.sowingDate);
  const queryCrop = planning ? crop : (record.crop.value ?? crop);
  const dateOk = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const querySowing = planning ? dateOk(sowingEdit) : sownDate;
  const suggest = useQuery({
    queryKey: ["field", workspaceId, fieldId, "suggest", record.season, queryCrop, querySowing],
    enabled: !!queryCrop && history.suitability?.blocked !== true,
    staleTime: 5 * 60_000,
    retry: false,
    placeholderData: (prev) => prev,
    queryFn: () =>
      api<Suggestion>(
        `${base}/season-records/${record.season}/suggest?crop=${encodeURIComponent(queryCrop)}${
          querySowing ? `&sowing=${querySowing}` : ""
        }`,
      ),
  });
  const sug = suggest.data && suggest.data.crop === queryCrop ? suggest.data : null;
  const sw = sug?.sowing;

  const pickCrop = (id: string) => {
    setCrop(id);
    setTouched(true);
    setSowingEdit(null);
    setTillageEdit(null);
    setMarkingSown(false);
    setSaved(false);
  };

  const sowing = sowingEdit ?? sw?.best ?? null;
  const tillage = tillageEdit ?? sug?.tillage?.value ?? null;
  // Emergence is shown only for a sowing date that exists, and only as an estimate until it is confirmed.
  const expected = sug?.emergence?.date ?? null;

  const save = useMutation({
    onError: (e, body) => fail(e, f("spSaveWhat"), () => save.mutate(body)),
    mutationFn: (body: Body) =>
      api<SeasonRecord>(`${base}/season-records/${record.season}`, { method: "PUT", body }),
    onSuccess: (r) => {
      client.setQueryData(["field", workspaceId, fieldId, "season"], r);
      setSaved(true);
      setEditing(null);
      setMarkingSown(false);
    },
  });
  const run = (body: Body) => {
    setSaved(false);
    save.mutate(body);
  };

  /** The planning payload: untouched recommendations keep their origin, typed dates are the agronomist's plan. */
  const planBody = (): Body => {
    const sources: Record<string, string> = {};
    if (cropOrigin === "plan") sources.crop = "plan";
    if (sowing)
      sources.sowingDate = sowingEdit ? "plan" : sw?.bestBasis === "soil-temp" ? "estimate" : "regional";
    if (tillage && !tillageEdit) sources.tillage = "estimate";
    return {
      crop: crop || null,
      ...(sowing ? { sowingDate: sowing } : {}),
      ...(tillage ? { tillage } : {}),
      sources,
    };
  };

  const cropIds = (history.regionCrops?.length ? history.regionCrops : Object.keys(history.cropNames)).filter(
    (id) => id !== "fallow",
  );
  const shownCrop = planning || editing === "crop" ? crop : (record.crop.value ?? crop);
  if (shownCrop && !cropIds.includes(shownCrop)) cropIds.push(shownCrop);
  const cropOptions = [
    { value: "", label: t("spCropPlaceholder") },
    ...cropIds
      .map((id) => ({ value: id, label: name(id) }))
      .sort((a, b) => a.label.localeCompare(b.label, locale)),
  ];
  const tillageOptions = (withNone: boolean) => [
    ...(withNone ? [{ value: "", label: t("spTillageNone") }] : []),
    ...TILLAGE.map((v) => ({ value: v, label: t(`till_${v}`) })),
  ];

  const step = nextStep(stage, !!(planning ? crop : record.crop.value));
  const promptDue = emergencePromptDue({ stage, expected, today, snoozedUntil });
  const showPrompt = stage === "sown" && canEdit && (promptDue || askEarly);

  const edit = (which: Exclude<Editing, null>, initial: string) => {
    setEditing(which);
    setDraft(initial);
  };
  const resetRecommended = (which: "sowing" | "emergence" | "tillage") => {
    if (which === "sowing" && sw?.best)
      run({
        sowingDate: sw.best,
        sources: { sowingDate: sw.bestBasis === "soil-temp" ? "estimate" : "regional" },
      });
    else if (which === "emergence") run({ emergenceDate: null });
    else if (which === "tillage" && sug?.tillage)
      run({ tillage: sug.tillage.value, sources: { tillage: "estimate" } });
  };

  const crumbs = (
    <SeasonLabel
      year={record.season}
      hintLabel={t("hintLabel")}
      hintTemplate={`${t("hintSeason")} ${t("hintSeasonNow")}`}
    />
  );
  const title = planning
    ? t.rich("spTitlePlan", { season: () => crumbs })
    : t.rich("spTitleRun", { season: () => crumbs, crop: name(record.crop.value ?? crop) });

  const rowEditor = (
    which: Exclude<Editing, null>,
    control: ReactNode,
    resetLabel: string | null,
    onReset: () => void,
    onSave: () => void,
  ) => (
    <div className="grid gap-2">
      {control}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={onSave} disabled={save.isPending || (!draft && which !== "tillage")}>
          {t("save")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
          {t("spCancel")}
        </Button>
        {resetLabel && (
          <Button type="button" variant="link" onClick={onReset} className="text-small">
            {resetLabel}
          </Button>
        )}
      </div>
    </div>
  );

  const stageChip = (
    <Chip tone={planning ? "info" : "ok"}>{t(`spStage_${stage}`)}</Chip>
  );
  const emergenceMethod =
    sug?.emergence &&
    t(`spMethod_${sug.emergence.method.replaceAll("-", "_")}`, { gdd: sug.emergence.gdd ?? 0 });
  const sw0 = sw?.window
    ? [
        t("spWindow", { from: d(sw.window.from), to: d(sw.window.to) }),
        sw.bestBasis && sw.bestBasis !== "typical" ? t(`spBest_${sw.bestBasis.replace("-", "_")}`) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : t("spNoCalendar");

  const land = history.suitability ?? null;
  // Unsuitable land (not overridden): the crop choice is off and the reasons take its place, with the override.
  if (land?.blocked && planning)
    return (
      <Surface as="section" className="flex flex-col gap-3">
        <h2 className="text-h2 text-ink">{title}</h2>
        <LandBlocked workspaceId={workspaceId} fieldId={fieldId} suitability={land} canEdit={canEdit} compact />
      </Surface>
    );

  return (
    <Surface as="section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h2 text-ink">{title}</h2>
        {stageChip}
      </div>
      {land?.blocked && (
        <div className="mt-3">
          <LandBlocked workspaceId={workspaceId} fieldId={fieldId} suitability={land} canEdit={canEdit} compact />
        </div>
      )}
      {land?.status === "limited" && (
        <div className="mt-3">
          <LandBanner suitability={land} />
        </div>
      )}
      <p className="mt-1 text-small text-ink-2">{t(`spModels_${stage}`)}</p>
      <p role="status" className="mt-3 rounded-input bg-surface-2 p-3 text-small text-ink">
        {t(`spNext_${step}`)}
      </p>

      <div className="mt-4 grid gap-5">
        {planning ? (
          <>
            {/* Step: the crop */}
            <div className="max-w-md">
              <SelectField
                label={t("spCropStep")}
                name="crop"
                options={cropOptions}
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

            {crop && suggest.isPending && <Skeleton variant="text" rows={2} label={t("spLoading")} className="max-w-md" />}
            {crop && suggest.isError && !sug && <p className="text-small text-week">{t("spSuggestFailed")}</p>}

            {sw && (
              <Banner sug={sug!} name={name} d={d} season={record.season} onPick={canEdit ? pickCrop : undefined} />
            )}

            {crop && (sug || sowingEdit || suggest.isError) && (
              <div className="grid max-w-md gap-4">
                <div className="grid gap-1">
                  <TextField
                    label={t("spPlannedSowing")}
                    type="date"
                    value={sowing ?? ""}
                    onChange={(e) => {
                      setSowingEdit(e.target.value || null);
                      setSaved(false);
                    }}
                    hint={sw?.best ? `${t("spBestDate", { date: d(sw.best) })} · ${sw0}` : sw0}
                    disabled={!canEdit}
                  />
                  {canEdit && sowingEdit && sw?.best && (
                    <Button
                      type="button"
                      variant="link"
                      onClick={() => setSowingEdit(null)}
                      className="self-start text-small"
                    >
                      {t("spUseRecommended")}: {d(sw.best)}
                    </Button>
                  )}
                  <Why>{t("spSowingWhy")}</Why>
                </div>

                {sowing && (
                  <p className="text-small text-ink">
                    {expected
                      ? t("spExpectedEmergence", { date: d(expected) })
                      : t("spNoEmergence")}
                    {emergenceMethod && <span className="block text-ink-2">{emergenceMethod}</span>}
                  </p>
                )}

                <div>
                  <SelectField
                    label={t("spTillageOptional")}
                    options={tillageOptions(!sug?.tillage)}
                    value={tillage ?? ""}
                    onChange={(e) => {
                      setTillageEdit((e.target.value || null) as Tillage | null);
                      setSaved(false);
                    }}
                    hint={sug?.tillage ? tillageReason(t, sug.tillage) : t("spNoTillage")}
                    disabled={!canEdit}
                  />
                  <Why>{t("spTillageWhy")}</Why>
                </div>
              </div>
            )}

            {canEdit && markingSown && (
              <div className="grid max-w-md gap-3 rounded-input border border-line p-4">
                <TextField
                  label={t("spSownOn")}
                  type="date"
                  value={sownDraft}
                  max={today}
                  onChange={(e) => setSownDraft(e.target.value)}
                  hint={t("spSownHint")}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    disabled={save.isPending || !sownDraft}
                    aria-busy={save.isPending}
                    onClick={() => {
                      // Sowing and crop are now the agronomist's own, so they keep no origin label.
                      const body = planBody();
                      const sources = { ...body.sources };
                      delete sources.sowingDate;
                      delete sources.crop;
                      run({ ...body, sowingDate: sownDraft, sources });
                    }}
                  >
                    {t("spConfirmSown")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setMarkingSown(false)}>
                    {t("spCancel")}
                  </Button>
                </div>
              </div>
            )}

            {canEdit && !markingSown && (
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <Button
                  type="button"
                  className="w-full justify-center sm:w-auto"
                  disabled={!crop}
                  onClick={() => {
                    setSownDraft(markSownDefault(sowing, today));
                    setMarkingSown(true);
                  }}
                >
                  {t("spMarkSown")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-center sm:w-auto"
                  onClick={() => run(planBody())}
                  disabled={save.isPending || !crop}
                  aria-busy={save.isPending}
                >
                  {t("spSavePlan")}
                </Button>
                {saved && (
                  <span role="status" className="text-small text-ok">
                    {t("saved")}
                  </span>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {showPrompt && (
              <div className="grid max-w-md gap-3 rounded-input border border-line bg-surface-2 p-4">
                <h3 className="text-h3 text-ink">{t("spEmergenceAsk")}</h3>
                <TextField
                  label={t("spEmergedOn")}
                  type="date"
                  value={emergenceDraft ?? emergenceDefault(expected, today)}
                  max={today}
                  min={sownDate ?? undefined}
                  onChange={(e) => setEmergenceDraft(e.target.value)}
                  hint={t("spNoSatellite")}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    disabled={save.isPending}
                    aria-busy={save.isPending}
                    onClick={() => run({ emergenceDate: emergenceDraft ?? emergenceDefault(expected, today) })}
                  >
                    {t("spYesOn", { date: d(emergenceDraft ?? emergenceDefault(expected, today)) })}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const until = snoozeUntil(today);
                      writeSnooze(snoozeStore, until);
                      setSnoozedUntil(until);
                      setAskEarly(false);
                    }}
                  >
                    {t("spNotYetBtn")}
                  </Button>
                </div>
              </div>
            )}

            <dl>
              <Row
                editing={editing}
                canEdit={canEdit}
                id="crop"
                label={t("crop")}
                value={name(record.crop.value ?? crop)}
                editor={rowEditor(
                  "crop",
                  <SelectField
                    label={t("crop")}
                    options={cropOptions}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />,
                  null,
                  () => undefined,
                  () => run({ crop: draft }),
                )}
                onEdit={() => edit("crop", record.crop.value ?? "")}
              />
              <Row
                editing={editing}
                canEdit={canEdit}
                id="sowing"
                label={t("spSownOn")}
                value={sownDate ? d(sownDate) : "—"}
                note={t("spYourValue")}
                editor={rowEditor(
                  "sowing",
                  <TextField
                    label={t("spSownOn")}
                    type="date"
                    value={draft}
                    max={today}
                    onChange={(e) => setDraft(e.target.value)}
                  />,
                  sw?.best ? t("spBackToPlanned", { date: d(sw.best) }) : null,
                  () => resetRecommended("sowing"),
                  () => run({ sowingDate: draft }),
                )}
                onEdit={() => edit("sowing", sownDate ?? "")}
              />
              {stage === "emerged" ? (
                <Row
                  editing={editing}
                  canEdit={canEdit}
                  id="emergence"
                  label={t("spEmergedOn")}
                  value={record.emergenceDate.value ? d(record.emergenceDate.value) : "—"}
                  note={t("spYourValue")}
                  editor={rowEditor(
                    "emergence",
                    <TextField
                      label={t("spEmergedOn")}
                      type="date"
                      value={draft}
                      max={today}
                      onChange={(e) => setDraft(e.target.value)}
                    />,
                    t("spClearEmergence"),
                    () => resetRecommended("emergence"),
                    () => run({ emergenceDate: draft }),
                  )}
                  onEdit={() => edit("emergence", record.emergenceDate.value ?? "")}
                />
              ) : (
                <div className="grid gap-1 border-t border-line py-3">
                  <dt className="text-small text-ink-2">{t("spExpectedLabel")}</dt>
                  <dd className="grid gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-h3 text-ink">{expected ? `≈ ${d(expected)}` : "—"}</span>
                      {expected && <Chip tone="week">{t("spEstimate")}</Chip>}
                    </span>
                    <div className="text-small text-ink-2">
                      {emergenceMethod ??
                        (suggest.isPending ? (
                          <Skeleton variant="text" rows={1} label={t("spLoading")} className="max-w-xs" />
                        ) : (
                          t("spNoEmergence")
                        ))}
                    </div>
                    {canEdit && !showPrompt && (
                      <Button
                        type="button"
                        variant="link"
                        onClick={() => setAskEarly(true)}
                        className="self-start text-small"
                      >
                        {t("spAlreadyUp")}
                      </Button>
                    )}
                  </dd>
                </div>
              )}
              <Row
                editing={editing}
                canEdit={canEdit}
                id="tillage"
                label={t("spTillageLabel")}
                value={record.tillage.value ? t(`till_${record.tillage.value}`) : t("spTillageNone")}
                note={record.tillage.value ? null : t("spTillageOptionalShort")}
                editor={rowEditor(
                  "tillage",
                  <SelectField
                    label={t("spTillageLabel")}
                    options={tillageOptions(true)}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    hint={sug?.tillage ? tillageReason(t, sug.tillage) : t("spTillageOptional")}
                  />,
                  sug?.tillage ? t("spUseRecommended") : null,
                  () => resetRecommended("tillage"),
                  () => run({ tillage: (draft || null) as Tillage | null }),
                )}
                onEdit={() => edit("tillage", record.tillage.value ?? "")}
              />
            </dl>
            {saved && (
              <span role="status" className="text-small text-ok">
                {t("saved")}
              </span>
            )}
          </>
        )}
      </div>
    </Surface>
  );
}


/** A confirmed value with its Edit link; the editor replaces it while editing. */
function Row({
  id,
  editing,
  canEdit,
  label,
  value,
  note,
  editor,
  onEdit,
}: {
  id: Exclude<Editing, null>;
  editing: Editing;
  canEdit: boolean;
  label: string;
  value: string;
  note?: string | null;
  editor: ReactNode;
  onEdit: () => void;
}) {
  const t = useTranslations("App");
  return (
    <div className="grid gap-1 border-t border-line py-3 first:border-t-0 first:pt-0">
      <dt className="text-small text-ink-2">{label}</dt>
      {editing === id ? (
        <dd>{editor}</dd>
      ) : (
        <dd className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-h3 text-ink">{value}</span>
          {note && <span className="text-small text-ink-2">{note}</span>}
          {canEdit && (
            <Button type="button" variant="link" onClick={onEdit} className="text-small">
              {t("spEdit")}
              <span className="sr-only"> {label}</span>
            </Button>
          )}
        </dd>
      )}
    </div>
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
              <Chip key={`${a.crop}-${a.season}`} onClick={() => onPick(a.crop)}>
                {label}
              </Chip>
            ) : (
              <Chip key={`${a.crop}-${a.season}`}>{label}</Chip>
            );
          })}
        </div>
      )}
    </div>
  );
}

