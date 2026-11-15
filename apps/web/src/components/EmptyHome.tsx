"use client";

import { Button, Kicker, Surface } from "@terrasight/ui";
import { Clock, Plus, Sparkles, Users } from "lucide-react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/**
 * Design 03 (S-01.05): first run with no fields. The Agronomist adds the first field; the Owner is pointed to Team in
 * Settings, because the agronomist does the field work. One primary action either way.
 */
export function EmptyHome({ firstName, isOwner = false }: { firstName: string; isOwner?: boolean }) {
  const t = useTranslations("EmptyHome");
  const a = useTranslations("App");
  const router = useRouter();

  const steps = [
    { icon: <Plus />, title: t("st1"), body: t("st1s") },
    { icon: <Clock />, title: t("st2"), body: t("st2s") },
    { icon: <Sparkles />, title: t("st3"), body: t("st3s") },
  ];

  if (isOwner) {
    return (
      <div className="flex flex-col gap-8">
        <div>
          <h1 className="text-h1 text-ink">{t("owner_hello", { name: firstName })}</h1>
          <p className="mt-3 max-w-[66ch] text-body text-ink-2">{t("owner_sub")}</p>
        </div>
        <Surface tone="hero" pad="lg" className="animate-rise flex max-w-xl flex-col gap-3">
          <span
            aria-hidden
            className="inline-flex size-10 items-center justify-center rounded-btn bg-muted [&>svg]:size-5 [&>svg]:stroke-[1.7]"
          >
            <Users />
          </span>
          <h2 className="text-h2 text-ink">{t("owner_title")}</h2>
          <p className="text-body text-ink-2">{t("owner_body")}</p>
          <Button size={56} icon={<Users />} onClick={() => router.push("/settings/team")} className="max-sm:w-full">
            {t("owner_cta")}
          </Button>
        </Surface>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-h1 text-ink">{a("helloName", { name: firstName })}</h1>
        <p className="mt-3 max-w-[66ch] text-body text-ink-2">{t("sub")}</p>
      </div>
      <div className="flex flex-col gap-3">
        <Kicker>{t("next")}</Kicker>
        <ol className="grid gap-4 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="stagger animate-rise" style={{ "--i": i } as CSSProperties}>
              <Surface pad="lg" className="h-full">
                <span
                  aria-hidden
                  className="mb-4 inline-flex size-10 items-center justify-center rounded-btn bg-muted [&>svg]:size-5 [&>svg]:stroke-[1.7]"
                >
                  {s.icon}
                </span>
                <span className="block text-caption font-semibold text-ink-2">{i + 1}</span>
                <h2 className="mt-2 text-h3 text-ink">{s.title}</h2>
                <p className="mt-2 text-body text-ink-2">{s.body}</p>
              </Surface>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size={56} icon={<Plus />} onClick={() => router.push("/fields/new")} className="max-sm:w-full">
          {t("add")}
        </Button>
      </div>
    </div>
  );
}
