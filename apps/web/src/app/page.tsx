import { useTranslations } from "next-intl";
import { ArrowRight, Map } from "lucide-react";
import { Button, Chip } from "@terrasight/ui";

/**
 * EP-00 placeholder for "/": the empty home (design 03) is built in S-01.05. It proves the wiring:
 * tokens, components and UA/EN copy from design/i18n.
 */
export default function Home() {
  const t = useTranslations("EmptyHome");
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-16">
      <Chip tone="source">EP-00 · foundation</Chip>
      <h1 className="text-h1 text-ink">{t("hello")}</h1>
      <p className="text-body text-ink-2">{t("sub")}</p>
      <ol className="flex flex-col gap-3">
        {(["st1", "st2", "st3"] as const).map((k, i) => (
          <li key={k} className="rounded-card border border-line bg-surface p-5">
            <span className="text-micro text-ink-3">0{i + 1}</span>
            <p className="text-[18px] leading-6 font-semibold text-ink">{t(k)}</p>
            <p className="text-small text-ink-2">{t(`${k}s`)}</p>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-3">
        <Button size={52} icon={<Map />}>
          {t("add")}
        </Button>
        <Button size={52} variant="outline" icon={<ArrowRight />}>
          {t("demo")}
        </Button>
      </div>
    </main>
  );
}
