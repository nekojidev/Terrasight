const tag = (locale: string): string => (locale === "uk" ? "uk-UA" : "en-US");

/** Offset label like "UTC−6" for a zone, at the current date. */
export function utcOffset(tz: string, locale = "en"): string {
  try {
    const part = new Intl.DateTimeFormat(tag(locale), { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value;
    // "GMT+2" (en) and "GMT+2" (uk) both start with GMT; keep a plain "UTC" for zero offset.
    return (part ?? "GMT").replace("GMT", "UTC").replace("-", "−") || "UTC";
  } catch {
    return "UTC";
  }
}

/** "Chicago — Central Time (UTC−6)": the zone's own name in the UI language plus the offset. */
export function zoneLabel(tz: string, locale = "en"): string {
  let name = "";
  try {
    name =
      new Intl.DateTimeFormat(tag(locale), { timeZone: tz, timeZoneName: "longGeneric" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    /* unknown zone: fall back to the id */
  }
  const city = tz.split("/").pop()!.replaceAll("_", " ");
  return `${city}${name && name !== city ? ` — ${name}` : ""} (${utcOffset(tz, locale)})`;
}
