import type { GpmCheck } from "@terrasight/shared";
import type { DailyWeather, GpmSeries } from "@terrasight/sources";

const AGREE_BAND_PCT = 2;

export const UNAVAILABLE: GpmCheck = {
  status: "unavailable",
  early: null,
  late: null,
  powerChangePct: null,
  imergChangePct: null,
  agree: null,
  lastDate: null,
};

/** Months of the growing season of season-year `y`: 1 Apr–30 Sep north; 1 Oct y–31 Mar y+1 south. */
function seasonMonths(y: number, south: boolean): string[] {
  const pad = (n: number) => String(n).padStart(2, "0");
  return south
    ? [10, 11, 12].map((m) => `${y}-${pad(m)}`).concat([1, 2, 3].map((m) => `${y + 1}-${pad(m)}`))
    : [4, 5, 6, 7, 8, 9].map((m) => `${y}-${pad(m)}`);
}

const daysIn = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (early: number, late: number) => (early > 0 ? Math.round(((late - early) / early) * 1000) / 10 : null);

/**
 * Growing-season precipitation per season-year from both datasets, early half vs late half of the years that are complete
 * in both. Pure; returns the "unavailable" check when fewer than 4 common years exist or the early mean is zero.
 */
export function computeGpmCheck(series: GpmSeries, power: DailyWeather, lat: number): GpmCheck {
  const south = lat < 0;
  const imerg = new Map(series.months.map((m) => [m.month, m.mm]));
  const daily = power.values.PRECTOTCORR;
  const powerMonth = new Map<string, { sum: number; days: number }>();
  power.dates.forEach((d, k) => {
    const v = daily[k];
    if (v === null || v === undefined || v < 0) return;
    const m = d.slice(0, 7);
    const cur = powerMonth.get(m) ?? { sum: 0, days: 0 };
    cur.sum += v;
    cur.days += 1;
    powerMonth.set(m, cur);
  });
  const rows: Array<{ year: number; imerg: number; power: number }> = [];
  const firstYear = Number(series.months[0]?.month.slice(0, 4) ?? 2001);
  const lastYear = Number(series.months.at(-1)?.month.slice(0, 4) ?? firstYear);
  for (let y = firstYear; y <= lastYear; y++) {
    const months = seasonMonths(y, south);
    const im = months.map((m) => imerg.get(m));
    const pw = months.map((m) => powerMonth.get(m));
    if (im.some((v) => v === null || v === undefined)) continue;
    if (pw.some((p, k) => !p || p.days !== daysIn(months[k]!))) continue;
    rows.push({
      year: y,
      imerg: (im as number[]).reduce((a, b) => a + b, 0),
      power: pw.reduce((a, p) => a + p!.sum, 0),
    });
  }
  if (rows.length < 4) return { ...UNAVAILABLE };
  const half = Math.floor(rows.length / 2);
  const early = rows.slice(0, half);
  const late = rows.slice(rows.length - half);
  const imergChangePct = pct(mean(early.map((r) => r.imerg)), mean(late.map((r) => r.imerg)));
  const powerChangePct = pct(mean(early.map((r) => r.power)), mean(late.map((r) => r.power)));
  if (imergChangePct === null || powerChangePct === null) return { ...UNAVAILABLE };
  const sameSign = Math.sign(imergChangePct) === Math.sign(powerChangePct);
  const bothSmall = Math.abs(imergChangePct) <= AGREE_BAND_PCT && Math.abs(powerChangePct) <= AGREE_BAND_PCT;
  return {
    status: "ready",
    early: { from: early[0]!.year, to: early.at(-1)!.year },
    late: { from: late[0]!.year, to: late.at(-1)!.year },
    powerChangePct,
    imergChangePct,
    agree: sameSign || bothSmall,
    lastDate: series.lastDate,
  };
}
