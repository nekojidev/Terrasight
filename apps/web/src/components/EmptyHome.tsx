"use client";

import { Button, Chip, FieldThumb } from "@terrasight/ui";
import { Clock, Eye, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { api, ApiError, setCookie, WORKSPACE_COOKIE } from "@/lib/api";

/** Design 03 (S-01.05): first run with no fields. */
export function EmptyHome({ firstName }: { firstName: string }) {
  const t = useTranslations("EmptyHome");
  const a = useTranslations("App");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function openDemo() {
    setBusy(true);
    setNote(null);
    try {
      const ws = await api<{ id: string }>("/api/workspaces/demo-copy", { method: "POST" });
      setCookie(WORKSPACE_COOKIE, ws.id);
      router.refresh();
    } catch (e) {
      setNote(e instanceof ApiError && e.code === "demo-not-seeded" ? a("demoUnavailable") : a("errGeneric"));
      setBusy(false);
    }
  }

  const steps = [
    { icon: <Plus />, title: t("st1"), body: t("st1s") },
    { icon: <Clock />, title: t("st2"), body: t("st2s") },
    { icon: <Sparkles />, title: t("st3"), body: t("st3s") },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        {/* Design copy "hello" has the demo name baked in; App.helloName takes the signed-in user's name. */}
        <h1 className="text-h1 text-ink">{a("helloName", { name: firstName })}</h1>
        <p className="mt-3 max-w-[66ch] text-body text-ink-2">{t("sub")}</p>
      </div>
      <ol className="grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className="animate-rise rounded-card border border-line bg-surface p-6"
            style={{ animationDelay: `${i * 85}ms` }}
          >
            <span
              aria-hidden
              className="mb-4 inline-flex size-10 items-center justify-center rounded-btn bg-muted [&>svg]:size-5 [&>svg]:stroke-[1.7]"
            >
              {s.icon}
            </span>
            <span className="block text-small font-semibold text-ink-2">{i + 1}</span>
            <h2 className="mt-2 text-[20px] leading-7 font-bold text-ink">{s.title}</h2>
            <p className="mt-2 text-body text-ink-2">{s.body}</p>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <Button size={56} icon={<Plus />} onClick={() => router.push("/fields/new")}>
          {t("add")}
        </Button>
        <Button
          size={56}
          variant="outline"
          icon={<Eye />}
          onClick={() => void openDemo()}
          disabled={busy}
          aria-busy={busy}
        >
          {t("demo")}
        </Button>
        {note && (
          <p role="status" className="text-body text-ink-2">
            {note}
          </p>
        )}
      </div>
      <div
        aria-label={t("ex_k")}
        className="relative rounded-card border border-dashed border-line-strong bg-surface-2 p-5 opacity-80"
      >
        <span className="absolute -top-3 left-4 rounded-chip bg-ink px-3 py-1 text-[12px] font-semibold text-surface">
          {t("ex")}
        </span>
        <div className="flex items-center gap-4">
          <FieldThumb name={t("ex_n")} shape="strip" crop="fallow" size={64} />
          <div className="min-w-0">
            <p className="text-small text-ink-3">
              {t("ex_k")} · {t("ex_n")}
            </p>
            <p className="text-[18px] leading-6 font-semibold text-ink">{t("ex_a")}</p>
            <p className="text-body text-ink-2">{t("ex_w")}</p>
            <p className="mt-2 flex flex-wrap items-center gap-3">
              <Chip tone="urgent">{t("ex_d")}</Chip>
              <span className="inline-flex items-center gap-1.5 text-small text-ink-2">
                <ShieldCheck aria-hidden className="size-4 text-ok" strokeWidth={1.7} />
                {t("ex_c")}
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
