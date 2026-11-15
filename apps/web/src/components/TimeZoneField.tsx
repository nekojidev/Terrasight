"use client";

import { Button, SelectField, TextField } from "@terrasight/ui";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { allZones, commonZones, filterZones, zoneLabel } from "@/lib/time-zone";

const OTHER = "__other__";

/**
 * Time zone picker: a short list (the detected zone and the usual zones of its region) with "Other…" that opens the
 * full list with a search box, instead of one list of 400 zones.
 */
export function TimeZoneField({
  value,
  onChange,
  detected,
  hint,
}: {
  value: string;
  onChange: (zone: string) => void;
  /** The browser's zone; marked "detected automatically" in the short list. */
  detected?: string;
  hint?: string;
}) {
  const t = useTranslations("Onboarding");
  const a = useTranslations("App");
  const locale = useLocale();
  const short = useMemo(() => commonZones(value, detected ?? value), [value, detected]);
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState("");
  const everything = useMemo(() => (all ? allZones([value]) : []), [all, value]);
  const found = useMemo(
    () => filterZones(everything, query, locale).slice(0, 200),
    [everything, query, locale],
  );
  const label = (z: string) =>
    detected && z === detected ? `${zoneLabel(z, locale)} — ${a("tzDetected")}` : zoneLabel(z, locale);

  if (all)
    return (
      <div className="flex flex-col gap-3">
        <TextField
          label={t("tzSearch")}
          hint={t("tzSearchHint")}
          type="search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <SelectField
          label={t("tz")}
          value={found.includes(value) ? value : ""}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          options={[
            ...(found.includes(value)
              ? []
              : [{ value: "", label: found.length ? zoneLabel(value, locale) : t("tzNone") }]),
            ...found.map((z) => ({ value: z, label: zoneLabel(z, locale) })),
          ]}
          hint={hint}
        />
        <Button variant="link" className="min-h-tap self-start" onClick={() => setAll(false)}>
          {t("tzShort")}
        </Button>
      </div>
    );

  return (
    <SelectField
      label={t("tz")}
      hint={hint}
      value={value}
      onChange={(e) => (e.target.value === OTHER ? setAll(true) : onChange(e.target.value))}
      options={[...short.map((z) => ({ value: z, label: label(z) })), { value: OTHER, label: t("tzOther") }]}
    />
  );
}
