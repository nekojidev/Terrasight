"use client";

import { Button } from "@terrasight/ui";
import { Clock, Plus, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/** Design 03 (S-01.05): first run with no fields. */
export function EmptyHome({ firstName }: { firstName: string }) {
  const t = useTranslations("EmptyHome");
  const a = useTranslations("App");
  const router = useRouter();

  const steps = [
    { icon: <Plus />, title: t("st1"), body: t("st1s") },
    { icon: <Clock />, title: t("st2"), body: t("st2s") },
    { icon: <Sparkles />, title: t("st3"), body: t("st3s") },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
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
      </div>
    </div>
  );
}
