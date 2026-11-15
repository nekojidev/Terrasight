"use client";

import { Button } from "@terrasight/ui";
import { ArrowLeft, Camera, Check, ChevronLeft, ChevronRight, LocateFixed, Minus, Plus, Send } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { OfflineCard } from "@/components/OfflineBanner";
import { api, ApiError } from "@/lib/api";
import { clearDraft, loadDraft, saveDraft, useOnline } from "@/lib/offline";
import dynamic from "next/dynamic";
import { MapSkeleton } from "@/components/MapSkeleton";

const ScoutMap = dynamic(() => import("./ScoutMap").then((m) => m.ScoutMap), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

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

const rad = (d: number) => (d * Math.PI) / 180;
/** Great-circle distance in metres. */
function distance(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
const fmtDist = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

/** The 5-point check (design 12, RFC §10.7): map on top, counter in a bottom sheet within thumb reach. */
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
  const [queued, setQueued] = useState(false);
  const online = useOnline();
  const clientId = useRef<string>("");

  // Draft in the browser, labelled "Saved automatically"; survives offline and reloads.
  useEffect(() => {
    const d = task.status === "open" ? loadDraft(task.id) : null;
    if (d) {
      setCounts(d.counts);
      setQueued(d.queued === true);
      clientId.current = d.clientId;
    }
    if (!clientId.current) clientId.current = crypto.randomUUID();
  }, [task.id, task.status]);
  useEffect(() => {
    if (task.status === "open") saveDraft(task.id, { counts, clientId: clientId.current, queued });
    else clearDraft(task.id);
  }, [counts, queued, task.id, task.status]);

  // Optional geolocation ("you are here" + distance to the next point); only after the user taps the button.
  const [geo, setGeo] = useState<"off" | "asking" | "on" | "denied">("off");
  const [here, setHere] = useState<{ lon: number; lat: number } | null>(null);
  const watch = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    },
    [],
  );
  function locate() {
    if (!("geolocation" in navigator)) return setGeo("denied");
    setGeo("asking");
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        setHere({ lon: p.coords.longitude, lat: p.coords.latitude });
        setGeo("on");
      },
      () => setGeo("denied"),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
  }

  const checked = counts.filter((c) => c !== null).length;
  const current = counts[at];
  const set = (v: number) => setCounts((c) => c.map((x, i) => (i === at ? Math.max(0, Math.min(20, v)) : x)));
  const nextPoint = (() => {
    const i = counts.findIndex((c, k) => c === null && k >= at);
    const j = i >= 0 ? i : counts.findIndex((c) => c === null);
    return j >= 0 ? { i: j, p: task.points[j]! } : null;
  })();
  const last = at === task.points.length - 1;
  const pestName = task.pest.name[locale];

  async function send() {
    setMsg(null);
    if (!navigator.onLine) {
      setQueued(true); // sent automatically when the connection is back
      return;
    }
    setBusy(true);
    try {
      const r = await api<ScoutTask>(`/api/w/${workspaceId}/scouting-tasks/${task.id}/send`, {
        body: { clientId: clientId.current, counts },
      });
      setQueued(false);
      setTask(r);
    } catch (e) {
      // Lost the connection mid-send: keep it queued; any other failure stops the auto-retry.
      const lost = !(e instanceof ApiError) && !navigator.onLine;
      setQueued(lost);
      if (lost) return;
      setMsg(e instanceof ApiError ? (e.problem.detail ?? t("errGeneric")) : t("errGeneric"));
    } finally {
      setBusy(false);
    }
  }
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (online && queued && !busy && task.status === "open") void sendRef.current();
  }, [online, queued, busy, task.status]);

  async function photo(f: File | undefined) {
    if (!f) return;
    if (!navigator.onLine) {
      setMsg(t("scPhotoOffline"));
      return;
    }
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
        <span className="flex items-center gap-1 text-small text-ok">
          <Check aria-hidden className="size-4" />
          {s("offline")}
        </span>
      </header>
      <section className="px-4">
        <h1 className="text-h2 text-ink">{s("title")}</h1>
        <p className="text-small text-ink-2">
          {task.fieldName} · {pestName}
        </p>
      </section>
      <ScoutMap
        outline={task.outline}
        points={task.points}
        counts={counts}
        at={at}
        onSelect={setAt}
        user={here}
        label={t("scMapLabel")}
      />
      <div className="flex items-center justify-between gap-3 px-4 py-2 text-small text-ink-2">
        {here && nextPoint ? (
          <span aria-live="polite">
            {t("scDistance", { n: nextPoint.i + 1, d: fmtDist(distance(here, nextPoint.p)) })}
          </span>
        ) : geo === "denied" ? (
          <span role="status">{t("scGeoDenied")}</span>
        ) : (
          <span>{geo === "asking" ? t("scLocating") : s("route")}</span>
        )}
        {geo === "off" && (
          <Button variant="outline" icon={<LocateFixed />} onClick={locate}>
            {t("scLocate")}
          </Button>
        )}
      </div>

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
          {queued ? (
            <div className="mt-3">
              <OfflineCard title={t("offlineTitle")} body={t("scQueued", { field: task.fieldName })} />
            </div>
          ) : checked === 5 ? (
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
