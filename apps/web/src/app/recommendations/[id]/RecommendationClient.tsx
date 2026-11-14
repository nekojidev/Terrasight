"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Chip, DoneRow, FactorRows, TextField, type Factor } from "@terrasight/ui";
import { ArrowLeft, Bug, Calendar, Check, Pencil, RefreshCw, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";

type Localised = { en: string; uk: string };
export interface RecView {
  id: string;
  fieldId: string;
  fieldName: string;
  type: "pest" | "disease" | "rotation" | "irrigation" | "sowing" | "weather";
  subject: string;
  season: number;
  status: "open" | "accepted" | "snoozed" | "in_report" | "dismissed" | "expired" | "superseded";
  level: "high" | "moderate" | "low" | "none" | "unknown";
  confidence: "high" | "medium" | "low";
  tier: "A" | "B" | "C";
  deadline: string | null;
  planning: boolean;
  irreversible: boolean;
  keyNumbers: Array<{ id: string; value: number | string; unit?: string; weight: number }>;
  drivers: Array<{ driver: string; value: number | string; unit?: string; fired: boolean }>;
  evidence: Array<{
    kind?: string;
    source?: string;
    from?: string;
    to?: string;
    value?: number | string;
    unit?: string;
    note?: string;
    threshold?: string;
    title?: string | null;
    publisher?: string | null;
    url?: string | null;
    accessed?: string | null;
    type?: string;
    quote?: string | null;
  }>;
  unknowns: string[];
  text: { title: Localised; action: Localised; why: Localised; scout: Localised | null };
  edited: boolean;
  snoozedUntil: string | null;
  undoUntil: string | null;
}

const LEVEL_TONE = {
  high: "text-urgent",
  moderate: "text-week",
  low: "text-ok",
  none: "text-ok",
  unknown: "text-ink-2",
} as const;

/** Recommendation detail (design 09, S-04.06): why, what we don't know, citations, owner message; lifecycle actions. */
export function RecommendationClient({
  workspaceId,
  timeZone,
  canAct,
  initial,
}: {
  workspaceId: string;
  timeZone: string;
  canAct: boolean;
  initial: RecView;
}) {
  const t = useTranslations("App");
  const r9 = useTranslations("Rec");
  const m = useTranslations("Main");
  const f = useTranslations("Field");
  const locale = useLocale() as "en" | "uk";
  const client = useQueryClient();
  const key = ["recommendation", workspaceId, initial.id];
  const rec = useQuery({
    queryKey: key,
    queryFn: () => api<RecView>(`/api/w/${workspaceId}/recommendations/${initial.id}`),
    initialData: initial,
  });
  const [editing, setEditing] = useState(false);
  const r = rec.data;
  const base = `/api/w/${workspaceId}/recommendations/${r.id}`;

  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
    }).format(new Date(`${iso}T12:00:00Z`));
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
      timeZone,
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  const label = (id: string) => (t.has(`kn_${id}`) ? t(`kn_${id}`) : id);
  const inputs = r.evidence.filter((e) => e.kind !== "citation");
  const citations = r.evidence.filter((e) => e.kind === "citation");
  const stamp = inputs[0]?.source;
  const factors: Factor[] = r.keyNumbers.map((k) => ({
    label: label(k.id),
    value: `${k.value}${k.unit && k.unit !== "seasons" ? ` ${k.unit}` : ""}`,
    weight: k.weight,
    ...(stamp ? { source: stamp } : {}),
  }));

  async function act(action: "accept" | "snooze" | "dismiss" | "undo") {
    const next = await api<RecView>(`${base}/${action}`, { body: {} });
    client.setQueryData(key, next);
    void client.invalidateQueries({ queryKey: ["brief", workspaceId] });
    if (next.undoUntil)
      setTimeout(() => void rec.refetch(), new Date(next.undoUntil).getTime() - Date.now() + 1_500);
  }
  async function saveText(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const v = (k: string) => String(fd.get(k) ?? "").trim();
    const next = await api<RecView>(base, {
      method: "PATCH",
      body: {
        title: { en: v("titleEn"), uk: v("titleUk") },
        action: { en: v("actionEn"), uk: v("actionUk") },
      },
    });
    client.setQueryData(key, next);
    setEditing(false);
  }

  const status =
    r.status === "accepted"
      ? t("recStatus_accepted")
      : r.status === "in_report"
        ? t("recStatus_in_report")
        : r.status === "snoozed"
          ? t("recStatus_snoozed", { when: r.snoozedUntil ? when(r.snoozedUntil) : "—" })
          : r.status === "dismissed"
            ? t("recStatus_dismissed")
            : r.status === "expired"
              ? t("recStatus_expired")
              : null;
  const message = t("recMsg", {
    field: r.fieldName,
    title: r.text.title[locale],
    action: r.text.action[locale],
  });

  return (
    <div className="grid gap-8 xl:grid-cols-[1fr_380px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Link href="/" className="flex w-fit items-center gap-1 text-body text-ink-2 hover:text-ink">
          <ArrowLeft aria-hidden className="size-4" />
          {r9("back")}
        </Link>
        <div className="flex flex-wrap gap-2">
          {r.deadline && (
            <Chip tone={r.planning ? "info" : r.irreversible ? "urgent" : "week"} icon={<Calendar />}>
              {r.planning ? t("duePlan", { date: date(r.deadline) }) : t("dueBy", { date: date(r.deadline) })}
            </Chip>
          )}
          <Chip tone="neutral" icon={<Bug />}>
            {t(`type_${r.type}`)}
          </Chip>
          {r.edited && <Chip tone="neutral">{t("recEdited")}</Chip>}
        </div>
        <div>
          <h1 className="text-h1 text-ink">{r.text.title[locale]}</h1>
          <p className="mt-2 text-body text-ink-2">
            {r.fieldName} · {t("recSeason", { season: r.season })}
          </p>
        </div>

        <section className="flex flex-col gap-5 rounded-card border border-line bg-surface p-6">
          <dl className="flex flex-wrap gap-8">
            <div>
              <dt className="text-small text-ink-2">{r9("risk")}</dt>
              <dd className={`text-h2 ${LEVEL_TONE[r.level]}`}>{t(`recLevel_${r.level}`)}</dd>
            </div>
            <div>
              <dt className="text-small text-ink-2">{r9("conf")}</dt>
              <dd className="text-h2 text-ink">{t(`conf_${r.confidence}`)}</dd>
            </div>
            <div>
              <dt className="text-small text-ink-2">{r9("data")}</dt>
              <dd className="text-h2 text-ink">{f(`tier_${r.tier}`)}</dd>
            </div>
          </dl>
          <div>
            <h2 className="mb-2 font-mono text-small tracking-wide text-ink-2 uppercase">{r9("do_t")}</h2>
            <p className="text-[20px] leading-8 font-semibold text-ink">{r.text.action[locale]}</p>
          </div>
          {status && (
            <p role="status" className="text-body text-ink-2">
              {status}
            </p>
          )}
          {r.undoUntil ? (
            <DoneRow
              label={r.status === "accepted" ? m("acc_done") : m("snz_done")}
              undoLabel={m("undo")}
              undoUntil={r.undoUntil}
              onUndo={() => void act("undo")}
            />
          ) : (
            canAct &&
            r.status === "open" && (
              <div className="flex flex-wrap items-center gap-3">
                <Button icon={<Check />} onClick={() => void act("accept")}>
                  {r9("accept")}
                </Button>
                <Button variant="outline" onClick={() => void act("snooze")}>
                  {m("snooze")}
                </Button>
                <Link
                  href={`/fields/${r.fieldId}`}
                  className="focus-ring inline-flex min-h-tap items-center gap-2 rounded-btn border border-line-strong px-4 text-body font-semibold text-ink"
                >
                  <RefreshCw aria-hidden className="size-4" strokeWidth={1.7} />
                  {r9("compare")}
                </Link>
                <Button variant="ghost" icon={<X />} onClick={() => void act("dismiss")}>
                  {r9("dismiss")}
                </Button>
              </div>
            )
          )}
        </section>

        <section className="flex flex-col gap-5 rounded-card border border-line bg-surface p-6">
          <h2 className="text-h2 text-ink">{r9("why_t")}</h2>
          {factors.length > 0 && (
            <div className="rounded-input bg-surface-2 p-4">
              <h3 className="mb-2 text-body font-semibold text-ink">{t("recWhyFactors")}</h3>
              <FactorRows factors={factors} />
            </div>
          )}
          <div>
            <h3 className="mb-2 text-body font-semibold text-ink">{t("recSteps")}</h3>
            <p className="mb-3 text-body text-ink">{r.text.why[locale]}</p>
            <ol className="flex flex-col gap-2">
              {inputs.map((e, i) => (
                <li key={i} className="flex gap-3 text-small text-ink-2">
                  <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-chip bg-ink text-micro text-surface">
                    {i + 1}
                  </span>
                  <span>
                    <span className="font-semibold text-ink">{e.source}</span>
                    {e.from && ` · ${e.from}${e.to ? ` → ${e.to}` : ""}`}
                    {e.value !== undefined && ` · ${e.value}${e.unit ? ` ${e.unit}` : ""}`}
                    {e.note && ` · ${e.note}`}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="mb-2 text-body font-semibold text-ink">{t("recUnknown")}</h3>
            {r.unknowns.length ? (
              <ul className="list-disc pl-5 text-small text-ink-2">
                {r.unknowns.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            ) : (
              <p className="text-small text-ink-2">{t("recNothingUnknown")}</p>
            )}
          </div>
          {r.text.scout && (
            <p className="rounded-input bg-week-soft p-4 text-body text-ink">
              <span className="font-semibold">{t("recScout")}.</span> {r.text.scout[locale]}
            </p>
          )}
        </section>
      </div>

      <aside className="flex flex-col gap-4">
        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="text-body font-semibold text-ink">{t("recMsgTitle")}</h2>
          <p className="mt-3 rounded-input bg-surface-2 p-4 text-body text-ink">{message}</p>
          {canAct && !editing && (
            <Button variant="outline" icon={<Pencil />} className="mt-3" onClick={() => setEditing(true)}>
              {t("recEdit")}
            </Button>
          )}
          {editing && (
            <form onSubmit={(e) => void saveText(e)} className="mt-3 flex flex-col gap-3">
              <TextField label={t("recTitleEn")} name="titleEn" defaultValue={r.text.title.en} required />
              <TextField label={t("recTitleUk")} name="titleUk" defaultValue={r.text.title.uk} required />
              <TextField label={t("recActionEn")} name="actionEn" defaultValue={r.text.action.en} required />
              <TextField label={t("recActionUk")} name="actionUk" defaultValue={r.text.action.uk} required />
              <div className="flex gap-2">
                <Button type="submit">{t("recSaveText")}</Button>
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  {t("recCancel")}
                </Button>
              </div>
            </form>
          )}
        </section>
        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="text-body font-semibold text-ink">{t("recModel")}</h2>
          <ul className="mt-3 flex flex-col gap-3 text-small text-ink-2">
            {citations.map((c) => (
              <li key={c.threshold}>
                <span className="font-mono text-ink">
                  {c.threshold} = {c.value} {c.unit}
                </span>
                <span className="block">
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                      {c.title}
                    </a>
                  ) : (
                    c.title
                  )}
                  {c.publisher && ` · ${c.publisher}`}
                  {c.type === "calibration" && ` · ${t("recCalibration")}`}
                </span>
                {c.quote && <span className="block italic">“{c.quote}”</span>}
                {c.accessed && (
                  <span className="block text-micro text-ink-3">
                    {t("recAccessed", { date: c.accessed })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="text-body font-semibold text-ink">{t("recSources")}</h2>
          <ul className="mt-3 list-disc pl-5 text-small text-ink-2">
            {[...new Set(inputs.map((e) => e.source).filter(Boolean))].map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p className="mt-3 flex items-center gap-1.5 text-micro text-ink-3">
            <ShieldCheck aria-hidden className="size-3.5" strokeWidth={1.7} />
            {m("neutral")}
          </p>
        </section>
      </aside>
    </div>
  );
}
