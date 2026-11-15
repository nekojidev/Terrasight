"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Chip } from "@terrasight/ui";
import { CircleAlert, MapPinned, ShieldAlert, ShieldCheck, TriangleAlert, Undo2 } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useReportError } from "@/components/useReportError";

export type LandStatus = "suitable" | "limited" | "unsuitable" | "unknown";

export interface LandReason {
  code: string;
  level: "limited" | "unsuitable";
  value: number | string;
  threshold: number | string;
  unit: string;
  source: string;
  sourceUrl: string;
  verified: boolean;
  mvpDefault: boolean;
  detail?: string;
}

/** What GET field / history / preview return as `suitability` (the preview has no override). */
export interface LandView {
  status: LandStatus;
  reasons: LandReason[];
  computedAt?: string | null;
  override?: { userId: string; userName?: string | null; at: string } | null;
  /** True while crop recommendations are stopped: unsuitable and not overridden. */
  blocked?: boolean;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** One plain-language sentence for a reason, with its numbers. */
export function reasonText(t: Translate, r: LandReason): string {
  return t(`landR_${r.code}_${r.level}`, {
    value: r.value,
    threshold: r.threshold,
    detail: r.detail && /^[a-z]+$/.test(r.detail) ? t(`landDetail_${r.detail}`) : (r.detail ?? ""),
  });
}

const TONE = { suitable: "ok", limited: "week", unsuitable: "urgent", unknown: "neutral" } as const;

/** Status chip for lists and the brief: only what needs attention (unsuitable / limited / overridden). */
export function LandChip({
  status,
  overridden = false,
}: {
  status: LandStatus | "overridden" | null | undefined;
  overridden?: boolean;
}) {
  const a = useTranslations("App");
  const t = a as unknown as Translate;
  const s = status === "unsuitable" && overridden ? "overridden" : status;
  if (s !== "unsuitable" && s !== "limited" && s !== "overridden") return null;
  return (
    <Chip
      tone={s === "unsuitable" ? "urgent" : "week"}
      icon={s === "unsuitable" ? <ShieldAlert /> : <TriangleAlert />}
    >
      {t(`landChip_${s}`)}
    </Chip>
  );
}

/** Sets or removes the agronomist's "still cropland" override and refreshes everything that depends on it. */
export function useSuitabilityOverride(workspaceId: string, fieldId: string) {
  const qc = useQueryClient();
  const report = useReportError();
  const base = `/api/w/${workspaceId}/fields/${fieldId}/suitability-override`;
  const done = () => {
    void qc.invalidateQueries({ queryKey: ["field", workspaceId, fieldId] });
    void qc.invalidateQueries({ queryKey: ["scenarios", workspaceId, fieldId] });
    void qc.invalidateQueries({ queryKey: ["rotations", workspaceId] });
    void qc.invalidateQueries({ queryKey: ["fields", workspaceId] });
    void qc.invalidateQueries({ queryKey: ["brief", workspaceId] });
  };
  const set = useMutation({ mutationFn: () => api(base, { method: "PUT" }), onSuccess: done, onError: report });
  const clear = useMutation({ mutationFn: () => api(base, { method: "DELETE" }), onSuccess: done, onError: report });
  return { set, clear, busy: set.isPending || clear.isPending };
}

function Reasons({ reasons, sources }: { reasons: LandReason[]; sources: boolean }) {
  const a = useTranslations("App");
  const t = a as unknown as Translate;
  return (
    <ul className="flex flex-col gap-3">
      {reasons.map((r) => (
        <li key={`${r.code}:${r.level}`} className="flex flex-col gap-0.5">
          <span className="flex items-start gap-2 text-body text-ink">
            <CircleAlert
              aria-hidden
              className={`mt-0.5 size-4 shrink-0 ${r.level === "unsuitable" ? "text-urgent" : "text-week"}`}
            />
            {reasonText(t, r)}
          </span>
          {sources && (
            <span className="pl-6 text-small text-ink-2">
              {t("landSource", { source: r.source })}
              {r.mvpDefault ? ` · ${t("landMvp")}` : ""}{" "}
              <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="focus-ring underline">
                {t("landSourceLink")}
              </a>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** "Land suitability" card of the field overview (design 08): status, plain reasons with values and sources, override. */
export function LandSuitabilityCard({
  workspaceId,
  fieldId,
  suitability,
  canEdit,
}: {
  workspaceId: string;
  fieldId: string;
  suitability: LandView | null | undefined;
  canEdit: boolean;
}) {
  const a = useTranslations("App");
  const t = a as unknown as Translate;
  const locale = useLocale();
  const ov = useSuitabilityOverride(workspaceId, fieldId);
  if (!suitability) return null;
  const { status, override } = suitability;
  const tone = override && status === "unsuitable" ? "week" : TONE[status];
  const date = override
    ? new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { dateStyle: "medium" }).format(new Date(override.at))
    : "";
  return (
    <section aria-labelledby="land-title" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="land-title" className="flex items-center gap-2 text-h2 text-ink">
          <MapPinned aria-hidden className="size-5 text-ink-2" strokeWidth={1.7} />
          {t("landTitle")}
        </h2>
        <Chip
          tone={tone}
          icon={status === "suitable" ? <ShieldCheck /> : status === "unknown" ? <CircleAlert /> : <ShieldAlert />}
        >
          {t(`landStatus_${status}`)}
        </Chip>
      </div>
      <p className="text-small text-ink-2">{override && status === "unsuitable" ? t("landSub_overridden") : t(`landSub_${status}`)}</p>
      {suitability.reasons.length > 0 && <Reasons reasons={suitability.reasons} sources />}
      {override && status === "unsuitable" && (
        <p className="text-small text-ink-2">
          {t("landOverrideBy", { name: override.userName ?? "—", date })}
        </p>
      )}
      {canEdit && status === "unsuitable" && !override && (
        <div className="flex flex-col gap-2">
          <p className="text-small text-ink-2">{t("landOverrideHint")}</p>
          <Button variant="outline" className="self-start" disabled={ov.busy} onClick={() => ov.set.mutate()}>
            {t("landOverrideBtn")}
          </Button>
        </div>
      )}
      {canEdit && status === "unsuitable" && override && (
        <Button variant="outline" icon={<Undo2 />} className="self-start" disabled={ov.busy} onClick={() => ov.clear.mutate()}>
          {t("landOverrideClear")}
        </Button>
      )}
    </section>
  );
}

/** Warning banner for a limited land check (field page, rotation page, season planner). */
export function LandBanner({
  suitability,
  fieldId,
}: {
  suitability: LandView | null | undefined;
  /** When set, the banner links to the field page where the reasons are. */
  fieldId?: string;
}) {
  const a = useTranslations("App");
  const t = a as unknown as Translate;
  if (suitability?.status !== "limited") return null;
  return (
    <div role="status" className="flex flex-col gap-2 rounded-card border border-line bg-week-soft p-4">
      <p className="flex items-start gap-2 text-body font-semibold text-week">
        <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
        {t("landBanner")}
      </p>
      <Reasons reasons={suitability.reasons} sources={false} />
      {fieldId && (
        <Link href={`/fields/${fieldId}`} className="focus-ring w-fit text-small font-semibold text-ink underline">
          {t("landBannerLink")}
        </Link>
      )}
    </div>
  );
}

/** Explanation shown instead of crop options when the land is unsuitable (rotation page, season planner). */
export function LandBlocked({
  workspaceId,
  fieldId,
  suitability,
  canEdit,
  compact = false,
}: {
  workspaceId: string;
  fieldId: string;
  suitability: LandView;
  canEdit: boolean;
  compact?: boolean;
}) {
  const a = useTranslations("App");
  const t = a as unknown as Translate;
  const ov = useSuitabilityOverride(workspaceId, fieldId);
  return (
    <section role="status" className="flex flex-col gap-3 rounded-card border border-line bg-surface-2 p-6">
      <h2 className="flex items-center gap-2 text-h2 text-ink">
        <ShieldAlert aria-hidden className="size-5 shrink-0 text-urgent" />
        {compact ? t("landBlockedShort") : t("landBlockedTitle")}
      </h2>
      {!compact && <p className="text-body text-ink">{t("landBlockedBody")}</p>}
      <Reasons reasons={suitability.reasons} sources={!compact} />
      {canEdit ? (
        <Button variant="outline" className="self-start" disabled={ov.busy} onClick={() => ov.set.mutate()}>
          {t("landOverrideBtn")}
        </Button>
      ) : (
        <p className="text-small text-ink-2">{t("landBlockedReadOnly")}</p>
      )}
    </section>
  );
}

/** Add-field preview: warns before saving ("Most of this outline is built-up or water: check the boundary"). */
export function LandPreviewWarning({ suitability }: { suitability: LandView | null | undefined }) {
  const a = useTranslations("App");
  const t = a as unknown as Translate;
  if (!suitability || (suitability.status !== "unsuitable" && suitability.status !== "limited")) return null;
  return (
    <div
      role="status"
      className={`flex flex-col gap-2 rounded-input p-4 ${suitability.status === "unsuitable" ? "bg-urgent-soft text-urgent" : "bg-week-soft text-week"}`}
    >
      <p className="flex items-start gap-2 text-body font-semibold">
        <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
        {t(`landPreviewTitle_${suitability.status}`)}
      </p>
      <div className="text-ink">
        <Reasons reasons={suitability.reasons} sources={false} />
      </div>
      <p className="text-small text-ink-2">{t("landPreviewKeep")}</p>
    </div>
  );
}
