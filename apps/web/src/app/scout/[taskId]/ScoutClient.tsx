"use client";

import { Button } from "@terrasight/ui";
import { ArrowLeft, Camera, ChevronLeft, ChevronRight, Minus, Plus, Send } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Localised = { en: string; uk: string };
export interface ScoutTask {
  id: string;
  status: "open" | "sent";
  recommendationId: string;
  fieldName: string;
  pest: { id: string; name: Localised; scout: Localised | null };
  outline: { type: string; coordinates: number[][][][] | number[][][] } | null;
  points: Array<{ idx: number; lon: number; lat: number; affected: number | null }>;
  resultPct: number | null;
  sentAt: string | null;
  photos: Array<{ id: string; pointIdx: number; url: string }>;
}

const KEY = (id: string) => `ts.scout.${id}`;

/** The 5-point check (design 12, RFC §10.7): sketch on top, counter in a bottom sheet within thumb reach. */
export function ScoutClient({ workspaceId, initial }: { workspaceId: string; initial: ScoutTask }) {
  const t = useTranslations("App");
  const s = useTranslations("Scout");
  const locale = useLocale() as "en" | "uk";
  const [task, setTask] = useState(initial);
  const [counts, setCounts] = useState<Array<number | null>>(() => initial.points.map((p) => p.affected));
  const [at, setAt] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const clientId = useRef<string>("");

  // Draft in the browser, labelled "Saved automatically" (never "works offline").
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY(task.id));
      if (raw && task.status === "open") {
        const d = JSON.parse(raw) as { counts: Array<number | null>; clientId: string };
        setCounts(d.counts);
        clientId.current = d.clientId;
      }
    } catch {
      /* storage unavailable */
    }
    if (!clientId.current) clientId.current = crypto.randomUUID();
  }, [task.id, task.status]);
  useEffect(() => {
    try {
      if (task.status === "open")
        localStorage.setItem(KEY(task.id), JSON.stringify({ counts, clientId: clientId.current }));
      else localStorage.removeItem(KEY(task.id));
    } catch {
      /* storage unavailable */
    }
  }, [counts, task.id, task.status]);

  // Sketch: project the outline and points into a 320 × 320 box.
  const sketch = useMemo(() => {
    const rings: number[][][] =
      task.outline?.type === "MultiPolygon"
        ? (task.outline.coordinates as number[][][][]).map((p) => p[0]!)
        : task.outline
          ? [(task.outline.coordinates as number[][][])[0]!]
          : [];
    const all = [...rings.flat(), ...task.points.map((p) => [p.lon, p.lat])];
    const lons = all.map((c) => c[0]!);
    const lats = all.map((c) => c[1]!);
    const [x0, x1, y0, y1] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
    const k = Math.cos(((y0 + y1) / 2) * (Math.PI / 180));
    const scale = 280 / Math.max((x1 - x0) * k, y1 - y0, 1e-9);
    const P = (lon: number, lat: number) => [20 + (lon - x0) * k * scale, 300 - (lat - y0) * scale] as const;
    return {
      rings: rings.map((r) => r.map(([lon, lat]) => P(lon!, lat!).join(",")).join(" ")),
      points: task.points.map((p) => P(p.lon, p.lat)),
    };
  }, [task]);

  const checked = counts.filter((c) => c !== null).length;
  const current = counts[at];
  const set = (v: number) => setCounts((c) => c.map((x, i) => (i === at ? Math.max(0, Math.min(20, v)) : x)));
  const last = at === task.points.length - 1;
  const pestName = task.pest.name[locale];

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<ScoutTask>(`/api/w/${workspaceId}/scouting-tasks/${task.id}/send`, {
        body: { clientId: clientId.current, counts },
      });
      setTask(r);
    } catch (e) {
      setMsg(e instanceof ApiError ? (e.problem.detail ?? t("errGeneric")) : t("errGeneric"));
    } finally {
      setBusy(false);
    }
  }
  async function photo(f: File | undefined) {
    if (!f) return;
    try {
      const p = await api<{ url: string; method: string; headers: Record<string, string> }>(
        `/api/w/${workspaceId}/scouting-tasks/${task.id}/photos/presign`,
        { body: { pointIdx: at + 1, contentType: f.type || "image/jpeg", bytes: f.size } },
      );
      const local = p.url.startsWith("/");
      const res = await fetch(p.url, {
        method: p.method,
        headers: { ...p.headers, ...(local ? { "X-Requested-With": "fetch" } : {}) },
        body: f,
        credentials: local ? "include" : "omit",
      });
      setMsg(res.ok ? t("scPhotoAdded") : t("scPhotoFailed"));
    } catch {
      setMsg(t("scPhotoFailed"));
    }
  }

  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { day: "numeric", month: "long" }).format(
      new Date(iso),
    );
  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col bg-canvas">
      <header className="flex items-center justify-between px-4 py-3">
        <Link
          href={`/recommendations/${task.recommendationId}`}
          className="flex min-h-tap items-center gap-1 text-body text-ink"
        >
          <ArrowLeft aria-hidden className="size-5" />
          {s("back")}
        </Link>
        <span className="text-small text-ok">{s("offline")}</span>
      </header>
      <section className="px-4">
        <h1 className="text-h2 text-ink">{s("title")}</h1>
        <p className="text-small text-ink-2">
          {task.fieldName} · {pestName}
        </p>
      </section>
      <svg
        viewBox="0 0 320 320"
        role="img"
        aria-label={s("route_label")}
        className="mx-4 my-3 rounded-card bg-surface"
      >
        {sketch.rings.map((r, i) => (
          <polygon key={i} points={r} className="fill-muted stroke-line-strong" strokeWidth="2" />
        ))}
        <polyline
          points={sketch.points.map((p) => p.join(",")).join(" ")}
          fill="none"
          className="stroke-ink-3"
          strokeDasharray="4 4"
          strokeWidth="1.5"
        />
        {sketch.points.map(([x, y], i) => (
          <g key={i} onClick={() => setAt(i)} className="cursor-pointer">
            <circle
              cx={x}
              cy={y}
              r={i === at ? 14 : 11}
              className={
                i === at
                  ? "fill-signal stroke-ink"
                  : counts[i] !== null
                    ? "fill-ink"
                    : "fill-surface stroke-ink"
              }
              strokeWidth="2"
            />
            <text
              x={x}
              y={y + 4}
              textAnchor="middle"
              className={`text-[11px] font-bold ${counts[i] !== null && i !== at ? "fill-surface" : "fill-ink"}`}
            >
              {i + 1}
            </text>
          </g>
        ))}
      </svg>

      {task.status === "sent" ? (
        <section className="mx-4 rounded-card bg-surface p-5">
          <h2 className="text-h2 text-ink">{s("result")}</h2>
          <p className="mt-2 font-mono text-big-number text-ink">{task.resultPct}%</p>
          <p className="text-small text-ink-2">
            {t("scSent", { date: task.sentAt ? date(task.sentAt) : "—", pct: task.resultPct ?? 0 })}
          </p>
          <p className="mt-3 text-small text-ink-2">{s("loop")}</p>
        </section>
      ) : (
        <section
          aria-labelledby="sheet-title"
          className="mt-auto rounded-t-hero bg-surface px-4 pt-3 pb-6 shadow-sheet"
        >
          <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-chip bg-line-strong" />
          <h2 id="sheet-title" className="text-body font-semibold text-ink">
            {s("point")} {at + 1} {s("of5")}
          </h2>
          <p className="mb-3 text-small text-ink-2">{t("scHow", { pest: pestName.toLowerCase() })}</p>
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="icon"
              label={s("minus")}
              icon={<Minus />}
              onClick={() => set((current ?? 0) - 1)}
            />
            <p aria-live="polite" className="text-center">
              <span className="block font-mono text-big-number text-ink">{current ?? "—"}</span>
              <span className="text-small text-ink-2">{t("scCount")}</span>
            </p>
            <Button
              variant="icon"
              label={s("plus")}
              icon={<Plus />}
              onClick={() => set((current ?? 0) + 1)}
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              icon={<ChevronLeft />}
              onClick={() => setAt(Math.max(0, at - 1))}
              disabled={at === 0}
            >
              {s("prev")}
            </Button>
            <Button
              icon={last ? undefined : <ChevronRight />}
              onClick={() => (current === null ? set(0) : undefined, setAt(last ? at : at + 1))}
            >
              {last ? s("finish") : s("next")}
            </Button>
          </div>
          <Button
            variant="ghost"
            icon={<Camera />}
            className="mt-2 w-full justify-center"
            onClick={() => file.current?.click()}
          >
            {s("photo")}
          </Button>
          <input
            ref={file}
            type="file"
            accept="image/jpeg,image/png,image/heic"
            capture="environment"
            className="hidden"
            onChange={(e) => void photo(e.target.files?.[0])}
          />
          <p className="mt-3 text-small text-ink-2">
            {s("visited_l")}: <span className="font-mono text-ink">{checked} / 5</span>
          </p>
          {checked === 5 ? (
            <Button
              icon={<Send />}
              className="mt-3 w-full justify-center"
              onClick={() => void send()}
              disabled={busy}
              aria-busy={busy}
            >
              {s("send")}
            </Button>
          ) : (
            <p className="mt-3 text-small text-ink-3">{t("scSendWait")}</p>
          )}
          {msg && (
            <p role="status" className="mt-2 text-small text-ink-2">
              {msg}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
