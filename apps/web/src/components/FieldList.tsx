import { Chip } from "@terrasight/ui";
import { ChevronRight, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export interface FieldRow {
  id: string;
  name: string;
  areaHa: number;
  countyName: string | null;
  tier: "A" | "B" | "C";
  irrigation: "irrigated" | "dryland" | "unknown";
  gatherStatus: string | null;
}

const HA_TO_AC = 2.471054;

/** Plain field list (S-02.01 entry point). Design 07 (county map, weather by county) replaces it in EP-04. */
export async function FieldList({
  fields,
  units,
  canEdit,
}: {
  fields: FieldRow[];
  units: "metric" | "imperial";
  canEdit: boolean;
}) {
  const t = await getTranslations("App");
  const f = await getTranslations("Field");
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-h1 text-ink">{t("fieldsTitle")}</h1>
        {canEdit && (
          <Link
            href="/fields/new"
            className="focus-ring inline-flex min-h-12 items-center gap-2 rounded-btn bg-ink px-5 text-body font-semibold text-surface"
          >
            <Plus aria-hidden className="size-5" strokeWidth={1.7} />
            {t("addField")}
          </Link>
        )}
      </div>
      <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
        {fields.map((r) => {
          const area = units === "imperial" ? r.areaHa * HA_TO_AC : r.areaHa;
          const meta = [
            `${area.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units === "imperial" ? "ac" : "ha"}`,
            r.irrigation === "unknown" ? null : t(r.irrigation),
            r.countyName,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={r.id}>
              <Link
                href={`/fields/${r.id}`}
                className="focus-ring flex items-center gap-4 p-4 hover:bg-muted"
              >
                <span className="flex-1">
                  <span className="block text-body font-semibold text-ink">{r.name}</span>
                  <span className="block text-small text-ink-2">{meta}</span>
                </span>
                {r.gatherStatus === "running" && (
                  <Loader2 aria-label={t("gatherTitle")} className="size-4 animate-spin text-ink-2" />
                )}
                <Chip tone={r.tier === "A" ? "ok" : r.tier === "B" ? "info" : "week"}>
                  {f(`tier_${r.tier}`)}
                </Chip>
                <ChevronRight aria-hidden className="size-5 text-ink-3" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
