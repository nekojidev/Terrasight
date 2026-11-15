"use client";

import type { ClimateShift } from "@terrasight/shared";
import { Button, Skeleton, Surface, TextField } from "@terrasight/ui";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Brand } from "@/components/Brand";
import { ClimateShiftCard } from "@/components/ClimateShiftCard";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { api, ApiError } from "@/lib/api";
import { useFormat } from "@/lib/useFormat";
import type { ExploreOutline } from "./ExploreMap";

const ExploreMap = dynamic(() => import("./ExploreMap").then((m) => m.ExploreMap), {
  ssr: false,
  loading: () => <MapLoading />,
});

function MapLoading() {
  const t = useTranslations("App");
  return <Skeleton variant="map" label={t("loading")} />;
}

/** One entry of GET /api/public/outlines. */
export interface OutlineItem {
  id: string;
  name: string;
  place: string;
  areaHa: number;
  centroid: { lon: number; lat: number };
  geojsonUrl: string;
}

type Choice = { kind: "point"; lon: number; lat: number } | { kind: "outline"; id: string };
type Phase =
  | { s: "idle" }
  | { s: "loading" }
  | { s: "ready"; data: ClimateShift }
  | { s: "error"; code: "rate-limited" | "daily-cap" | "invalid-input" | "failed" };

/** "38,10", "38.10" and "−101.05" (typographic minus) all parse; anything else is null. */
export function parseCoordinate(raw: string, limit: number): number | null {
  const text = raw.trim().replace(",", ".").replace(/[−–]/g, "-");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Math.abs(n) <= limit ? n : null;
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export function ExploreClient({ outlines }: { outlines: OutlineItem[] }) {
  const t = useTranslations("Explore");
  const tMain = useTranslations("Main");
  const fmt = useFormat({ country: "US" });
  const [choice, setChoice] = useState<Choice | null>(null);
  const [phase, setPhase] = useState<Phase>({ s: "idle" });
  const [features, setFeatures] = useState<Record<string, GeoJSON.Feature>>({});
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [errors, setErrors] = useState<{ lat?: string; lon?: string }>({});
  const request = useRef(0);
  const result = useRef<HTMLDivElement>(null);

  // The outline shapes: public GET requests from the browser, committed files on the server.
  useEffect(() => {
    let alive = true;
    for (const o of outlines)
      void fetch(o.geojsonUrl, { credentials: "omit" })
        .then((r) => (r.ok ? (r.json() as Promise<GeoJSON.Feature>) : null))
        .then((f) => {
          if (alive && f) setFeatures((prev) => ({ ...prev, [o.id]: f }));
        })
        .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [outlines]);

  // On a phone the result must appear right under the tapped place: scroll to it once the choice is made.
  useEffect(() => {
    if (!choice) return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1024px)").matches) return;
    const id = requestAnimationFrame(() => result.current?.scrollIntoView?.({ block: "start", behavior: "smooth" }));
    return () => cancelAnimationFrame(id);
  }, [choice]);

  const load = useCallback(async (lonV: number, latV: number) => {
    const mine = ++request.current;
    setPhase({ s: "loading" });
    try {
      const data = await api<ClimateShift>("/api/public/climate-shift", {
        body: { lon: lonV, lat: latV },
        noRefresh: true,
      });
      if (mine === request.current) setPhase({ s: "ready", data });
    } catch (e) {
      if (mine !== request.current) return;
      const code = e instanceof ApiError ? e.code : "";
      setPhase({
        s: "error",
        code: code === "rate-limited" || code === "daily-cap" || code === "invalid-input" ? code : "failed",
      });
    }
  }, []);

  const choose = useCallback(
    (next: Choice) => {
      setChoice(next);
      if (next.kind === "point") {
        void load(next.lon, next.lat);
      } else {
        const o = outlines.find((x) => x.id === next.id);
        if (o) void load(o.centroid.lon, o.centroid.lat);
      }
    },
    [load, outlines],
  );

  const pickPoint = useCallback(
    (lonV: number, latV: number) => {
      const p = { lon: round(Math.max(-180, Math.min(180, lonV))), lat: round(Math.max(-90, Math.min(90, latV))) };
      setLat(String(p.lat));
      setLon(String(p.lon));
      setErrors({});
      choose({ kind: "point", ...p });
    },
    [choose],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const latV = parseCoordinate(lat, 90);
    const lonV = parseCoordinate(lon, 180);
    setErrors({
      ...(latV === null ? { lat: t("errLat") } : {}),
      ...(lonV === null ? { lon: t("errLon") } : {}),
    });
    if (latV !== null && lonV !== null) choose({ kind: "point", lon: lonV, lat: latV });
  };

  const selected = choice?.kind === "outline" ? outlines.find((o) => o.id === choice.id) : undefined;
  const mapOutlines: ExploreOutline[] = outlines.flatMap((o) =>
    features[o.id]
      ? [
          {
            id: o.id,
            name: o.name,
            label: t("fieldLabel", { name: o.name, place: o.place }),
            centroid: o.centroid,
            feature: features[o.id]!,
          },
        ]
      : [],
  );
  const where = selected
    ? t("whereField", { name: selected.name })
    : choice?.kind === "point"
      ? t("wherePoint", { lat: String(round(choice.lat, 2)), lon: String(round(choice.lon, 2)) })
      : "";

  return (
    <div className="min-h-dvh bg-bg">
      <header className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 md:px-8">
        <Brand />
        <nav className="flex flex-wrap items-center gap-3">
          <LanguageSwitch />
          <Link
            href="/login"
            className="focus-ring inline-flex min-h-11 items-center rounded-btn px-3 text-body font-semibold text-ink underline underline-offset-4"
          >
            {t("signIn")}
          </Link>
          <Link
            href="/login?mode=signup"
            className="focus-ring inline-flex min-h-11 items-center rounded-btn bg-ink px-4 text-body font-semibold text-surface"
          >
            {t("create")}
          </Link>
        </nav>
      </header>

      <main className="mx-auto grid w-full max-w-[1200px] gap-6 px-4 pb-10 md:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <h1 className="text-h1 text-ink">{t("title")}</h1>
          <p className="max-w-[70ch] text-body text-ink-2">{t("tag")}</p>
        </section>

        <section className="flex min-w-0 flex-col gap-4" aria-label={t("mapLabel")}>
          {outlines.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="text-body font-semibold text-ink">{t("fieldsTitle")}</h2>
              <ul className="flex flex-wrap gap-2">
                {outlines.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      aria-pressed={selected?.id === o.id}
                      onClick={() => choose({ kind: "outline", id: o.id })}
                      className="focus-ring min-h-11 rounded-chip border border-line-control bg-surface px-4 text-small font-semibold text-ink aria-pressed:bg-ink aria-pressed:text-surface"
                    >
                      {t("fieldBtn", { name: o.name, place: o.place, area: fmt.area(o.areaHa) })}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ExploreMap
            outlines={mapOutlines}
            selectedId={selected?.id ?? null}
            point={choice?.kind === "point" ? { lon: choice.lon, lat: choice.lat } : null}
            onPickPoint={pickPoint}
            onPickOutline={(id) => choose({ kind: "outline", id })}
            label={t("mapLabel")}
            markerLabel={t("markerLabel")}
          />
          <p className="text-small text-ink-2">{t("mapHint")}</p>

          <form onSubmit={submit} noValidate className="flex flex-col gap-3" aria-labelledby="coords-title">
            <h2 id="coords-title" className="text-body font-semibold text-ink">
              {t("coordsTitle")}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
              <TextField
                label={t("lat")}
                inputMode="decimal"
                autoComplete="off"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                {...(errors.lat ? { error: errors.lat } : {})}
              />
              <TextField
                label={t("lon")}
                inputMode="decimal"
                autoComplete="off"
                value={lon}
                onChange={(e) => setLon(e.target.value)}
                {...(errors.lon ? { error: errors.lon } : {})}
              />
              <Button type="submit" className="sm:mt-7">
                {t("show")}
              </Button>
            </div>
            <p className="text-small text-ink-2">{t("coordsHint")}</p>
          </form>
        </section>

        <section ref={result} className="flex min-w-0 flex-col gap-4" aria-live="polite">
          {phase.s === "idle" && (
            <Surface as="section">
              <p className="text-body text-ink-2">{t("nothingYet")}</p>
            </Surface>
          )}
          {phase.s !== "idle" && <h2 className="text-h2 text-ink">{t("resultTitle", { where })}</h2>}
          {phase.s === "loading" && (
            <>
              <p role="status" className="text-body text-ink-2">
                {t("loading")}
              </p>
              <ClimateShiftCard data={undefined} isLoading isError={false} onRetry={() => undefined} country="US" />
            </>
          )}
          {phase.s === "ready" && (
            <ClimateShiftCard
              data={phase.data}
              isLoading={false}
              isError={false}
              onRetry={() => retry()}
              compact
              {...(selected ? { country: "US" } : {})}
              units={selected ? "imperial" : "metric"}
            />
          )}
          {phase.s === "error" && (
            <Surface as="section" role="alert" className="flex flex-col items-start gap-3">
              <p className="text-body text-ink">
                {phase.code === "rate-limited"
                  ? t("rateLimited")
                  : phase.code === "daily-cap"
                    ? t("dailyCap")
                    : phase.code === "invalid-input"
                      ? t("badInput")
                      : t("failed")}
              </p>
              {phase.code !== "daily-cap" && phase.code !== "invalid-input" && (
                <Button variant="outline" onClick={() => retry()}>
                  {t("retry")}
                </Button>
              )}
            </Surface>
          )}
          {choice && phase.s === "ready" && (
            <Surface as="section" className="flex flex-col items-start gap-3">
              <Link
                href={selected ? "/login" : "/login?mode=signup"}
                className="focus-ring inline-flex min-h-12 items-center rounded-btn bg-ink px-5 text-body font-semibold text-surface"
              >
                {selected ? t("fieldNoteLink") : t("pointNoteLink")}
              </Link>
              <p className="text-small text-ink-2">{selected ? t("fieldNote") : t("pointNote")}</p>
            </Surface>
          )}
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-[1200px] flex-col gap-2 border-t border-line px-4 py-6 text-small text-ink-2 md:px-8">
        <p>{t("data")}</p>
        <p>{t("privacy")}</p>
        <p>{tMain("neutral")}</p>
      </footer>
    </div>
  );

  function retry() {
    if (choice) choose(choice);
  }
}
