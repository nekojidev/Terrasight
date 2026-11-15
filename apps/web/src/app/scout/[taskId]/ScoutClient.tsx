"use client";

import { Button, Kicker, ProgressBar, Surface } from "@terrasight/ui";
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  LocateFixed,
  Map as MapIcon,
  Minus,
  Plus,
  Send,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { clearDraft, loadDraft, saveDraft, useOnline } from "@/lib/offline";
import { useActionToast } from "@/lib/useActionToast";
import { useFormat } from "@/lib/useFormat";
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

const PLANTS = 20;
const rad = (d: number) => (d * Math.PI) / 180;
/** Great-circle distance in metres. */
function distance(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** The field check (design 12, RFC §10.7): map on top, a running summary, a big counter and a sticky action bar. */
export function ScoutClient({
  workspaceId,
  initial,
  country,
}: {
  workspaceId: string;
  initial: ScoutTask;
  /** The field's ISO country: picks metric or imperial units for the distance. */
  country?: string;
}) {
  const t = useTranslations("App");
  const s = useTranslations("Scout");
  const locale = useLocale() as "en" | "uk";
  const fmt = useFormat({ country });
  const { fail } = useActionToast();
  const [task, setTask] = useState(initial);
  const [counts, setCounts] = useState<Array<number | null>>(() => initial.points.map((p) => p.affected));
  const [at, setAt] = useState(0);
  const [confirmZero, setConfirmZero] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showMap, setShowMap] = useState(false);
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

  const total = task.points.length;
  const checked = counts.filter((c) => c !== null).length;
  const current = counts[at] ?? null;
  const ready = checked === total;
  const sum = counts.reduce<number>((a, c) => a + (c ?? 0), 0);
  const share = checked > 0 ? sum / (checked * PLANTS) : null;
  const set = (v: number) => {
    setConfirmZero(false);
    setCounts((c) => c.map((x, i) => (i === at ? Math.max(0, Math.min(PLANTS, v)) : x)));
  };
  const go = (i: number) => {
    setConfirmZero(false);
    setAt(Math.max(0, Math.min(total - 1, i)));
  };
  const nextPoint = (() => {
    const i = counts.findIndex((c, k) => c === null && k >= at);
    const j = i >= 0 ? i : counts.findIndex((c) => c === null);
    return j >= 0 ? { i: j, p: task.points[j]! } : null;
  })();
  const last = at === total - 1;
  const pestName = task.pest.name[locale];

  /** Next / Finish: an uncounted point is never recorded as 0 silently; ask first. */
  function advance() {
    if (current === null) {
      setConfirmZero(true);
      return;
    }
    go(last ? at : at + 1);
  }
  function recordZero() {
    setCounts((c) => c.map((x, i) => (i === at ? 0 : x)));
    setConfirmZero(false);
    if (!last) setAt(at + 1);
  }

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
      const lost = e instanceof TypeError && !navigator.onLine;
      setQueued(lost);
      if (!lost) fail(e, s("send"), () => void sendRef.current());
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
      if (res.ok) setMsg(t("scPhotoAdded"));
      else fail(new Error(t("scPhotoFailed")), s("photo"), () => void photo(f));
    } catch (e) {
      fail(e, s("photo"), () => void photo(f));
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col bg-canvas">
      <header className="flex items-center justify-between px-4 py-3">
        <Link
          href={`/recommendations/${task.recommendationId}`}
          className="focus-ring flex min-h-tap items-center gap-1 text-body text-ink"
        >
          <ArrowLeft aria-hidden className="size-5" />
          {s("back")}
        </Link>
        <span className="flex items-center gap-1 text-caption text-ok">
          <Check aria-hidden className="size-4" />
          {s("offline")}
        </span>
      </header>
      <section className="px-4">
        <h1 className="text-h2 text-ink">{s("title")}</h1>
        <p className="text-caption text-ink-2">
          {task.fieldName} · {pestName}
        </p>
      </section>
      {task.status === "open" && (
        <ScoutMap
          outline={task.outline}
          points={task.points}
          counts={counts}
          at={at}
          onSelect={go}
          user={here}
          label={t("scMapLabel")}
        />
      )}
      <div
        className={`flex items-center justify-between gap-3 px-4 py-2 text-caption text-ink-2 ${task.status === "sent" ? "hidden" : ""}`}
      >
        {here && nextPoint ? (
          <span aria-live="polite">
            {t("scDistance", { n: nextPoint.i + 1, d: fmt.distance(distance(here, nextPoint.p)) })}
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
        <>
          <Surface as="section" className="animate-rise mx-4 mt-2 mb-3">
            <h2 className="text-h2 text-ink">{s("result")}</h2>
            <p className="mt-2 text-big-number text-ink">{fmt.percent((task.resultPct ?? 0) / 100)}</p>
            <p className="text-caption text-ink-2">
              {t("scSent", { date: task.sentAt ? fmt.date(task.sentAt, "dayMonth") : "—", pct: task.resultPct ?? 0 })}
            </p>
            <p className="mt-3 text-caption text-ink-2">{s("loop")}</p>
          </Surface>
          <div className="mx-4 mb-6">
            <button
              type="button"
              aria-expanded={showMap}
              onClick={() => setShowMap((v) => !v)}
              className="focus-ring flex min-h-tap items-center gap-2 text-body font-semibold text-ink underline underline-offset-4"
            >
              <MapIcon aria-hidden className="size-4" strokeWidth={1.7} />
              {s("map_show")}
            </button>
            {showMap && (
              <ScoutMap
                outline={task.outline}
                points={task.points}
                counts={counts}
                at={at}
                onSelect={go}
                user={null}
                label={t("scMapLabel")}
              />
            )}
          </div>
        </>
      ) : (
        <>
          <Surface as="section" tone="inset" pad="sm" aria-label={s("summary")} className="mx-4 mb-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <Kicker>{s("visited_l")}</Kicker>
                <p className="font-mono text-h2 text-ink">
                  {fmt.number(checked)} / {fmt.number(total)}
                </p>
              </div>
              <div className="text-right">
                <Kicker>{s("share_l")}</Kicker>
                <p className="font-mono text-h2 text-ink">{share === null ? "—" : fmt.percent(share)}</p>
              </div>
            </div>
            <ProgressBar value={checked} max={total} label={s("visited_l")} tone="ok" className="mt-3" />
          </Surface>
          <section
            aria-labelledby="sheet-title"
            className="sticky bottom-0 mt-auto rounded-t-hero bg-surface px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-sheet"
          >
            <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-chip bg-line-strong" />
            <h2 id="sheet-title" className="text-body font-semibold text-ink">
              {s("point_n", { n: at + 1, total })}
            </h2>
            <p className="mb-3 text-caption text-ink-2">{t("scHow", { pest: pestName.toLowerCase() })}</p>
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="icon"
                label={s("minus")}
                icon={<Minus />}
                className="size-14"
                onClick={() => set((current ?? 0) - 1)}
              />
              <p aria-live="polite" className="text-center">
                <span className="block text-big-number text-ink">
                  {current === null ? "—" : fmt.number(current)}
                </span>
                <span className="text-caption text-ink-2">{t("scCount")}</span>
              </p>
              <Button
                variant="icon"
                label={s("plus")}
                icon={<Plus />}
                className="size-14"
                onClick={() => set((current ?? 0) + 1)}
              />
            </div>

            {confirmZero ? (
              <div role="alertdialog" aria-label={s("zero_q")} className="animate-fade mt-4 rounded-card bg-surface-2 p-4">
                <p className="text-body font-semibold text-ink">{s("zero_q")}</p>
                <p className="mt-1 text-caption text-ink-2">{s("zero_sub")}</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant="outline" size={52} onClick={() => setConfirmZero(false)}>
                    {s("zero_back")}
                  </Button>
                  <Button size={52} onClick={recordZero}>
                    {s("zero_record")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size={52}
                  icon={<ChevronLeft />}
                  onClick={() => go(at - 1)}
                  disabled={at === 0}
                >
                  {s("prev")}
                </Button>
                <Button
                  variant={ready ? "outline" : "primary"}
                  size={52}
                  icon={last ? undefined : <ChevronRight />}
                  onClick={advance}
                >
                  {last ? s("finish") : s("next")}
                </Button>
              </div>
            )}

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

            <Button
              size={52}
              icon={<Send />}
              className="mt-3 w-full justify-center"
              onClick={() => void send()}
              disabled={!ready || busy || queued}
              aria-busy={busy}
              aria-describedby="send-reason"
              variant={ready ? "primary" : "outline"}
            >
              {s("send")}
            </Button>
            <p id="send-reason" className="mt-2 flex items-start gap-2 text-caption text-ink-2" role="status">
              {queued ? (
                <>
                  <WifiOff aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.7} />
                  {s("queued")}
                </>
              ) : !ready ? (
                s("send_need", { n: total - checked })
              ) : null}
            </p>
            {msg && (
              <p role="status" className="mt-1 text-caption text-ink-2">
                {msg}
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
