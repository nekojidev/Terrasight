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

const COMMON: Record<string, string[]> = {
  America: [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Phoenix",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
    "America/Toronto",
    "America/Mexico_City",
    "America/Sao_Paulo",
  ],
  Europe: [
    "Europe/Kyiv",
    "Europe/Warsaw",
    "Europe/Bucharest",
    "Europe/Berlin",
    "Europe/Paris",
    "Europe/Madrid",
    "Europe/Rome",
    "Europe/London",
    "Europe/Istanbul",
  ],
  Asia: ["Asia/Kolkata", "Asia/Dubai", "Asia/Almaty", "Asia/Shanghai", "Asia/Tokyo", "Asia/Singapore"],
  Africa: ["Africa/Cairo", "Africa/Lagos", "Africa/Nairobi", "Africa/Johannesburg"],
  Australia: ["Australia/Perth", "Australia/Adelaide", "Australia/Sydney"],
  Pacific: ["Pacific/Auckland", "Pacific/Honolulu"],
};

const valid = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Every time zone the browser knows (plus UTC), for the "Other…" list. */
export function allZones(extra: string[] = []): string[] {
  const known = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return Array.from(new Set([...extra, ...known, "UTC"]));
}

/** Short list: the current zone first, then the detected one, the usual zones of its region, then UTC. */
export function commonZones(current: string, detected = current): string[] {
  const region = detected.split("/")[0] ?? "";
  const regional = (COMMON[region] ?? []).filter(valid);
  return Array.from(new Set([current, detected, ...regional, "UTC"]));
}

/** Case-insensitive filter on the zone id and its label (city and zone name). */
export function filterZones(zones: string[], query: string, locale = "en"): string[] {
  const raw = query.trim().toLowerCase();
  if (!raw) return zones;
  const id = raw.replaceAll(" ", "_");
  return zones.filter(
    (z) => z.toLowerCase().includes(id) || zoneLabel(z, locale).toLowerCase().includes(raw),
  );
}
