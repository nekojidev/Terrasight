import { CheckCircle2, ScanLine, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Brand } from "@/components/Brand";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { serverGet, type Me } from "@/lib/server-api";
import { LoginForm } from "./LoginForm";

/** Design 01: ink story panel on the left, the form on the right. */
export default async function LoginPage() {
  const me = await serverGet<Me>("/api/me");
  if (me.ok) redirect("/");
  const t = await getTranslations("Login");

  return (
    <main className="grid min-h-dvh lg:grid-cols-[52%_48%]">
      <section className="hidden flex-col justify-between bg-ink p-14 text-surface lg:flex">
        <Brand inverted />
        <PivotArt label={t("art")} />
        <div className="flex flex-col gap-5">
          <h2 className="text-h1 max-w-[16ch]">{t("tag")}</h2>
          <p className="max-w-[52ch] text-body opacity-80">{t("tag_s")}</p>
          <ul className="flex flex-wrap gap-2">
            {[
              [<ScanLine key="a" />, t("b1")],
              [<ShieldCheck key="b" />, t("b2")],
              [<CheckCircle2 key="c" />, t("b3")],
            ].map(([icon, label]) => (
              <li
                key={String(label)}
                className="inline-flex min-h-9 items-center gap-2 rounded-chip bg-surface/10 px-4 text-small font-semibold [&_svg]:size-4 [&_svg]:text-signal dark:[&_svg]:text-on-signal"
              >
                {icon}
                {label}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="flex flex-col px-6 py-8 sm:px-16">
        <div className="flex items-center justify-between">
          <Brand className="lg:invisible" />
          <LanguageSwitch />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        <p className="text-center text-small text-ink-3">{t("data")}</p>
      </section>
    </main>
  );
}

function PivotArt({ label }: { label: string }) {
  const pivots = [
    { cx: 190, cy: 120, r: 90, c: "var(--crop-corn)" },
    { cx: 380, cy: 110, r: 74, c: "var(--crop-wheat)" },
    { cx: 270, cy: 310, r: 96, c: "var(--crop-alfalfa)" },
    { cx: 470, cy: 280, r: 70, c: "var(--crop-soy)" },
  ];
  return (
    <svg role="img" aria-label={label} viewBox="0 0 600 420" className="w-full max-w-[560px]">
      {pivots.map((p) => (
        <g key={p.cx}>
          <circle cx={p.cx} cy={p.cy} r={p.r} fill={p.c} />
          <line
            x1={p.cx}
            y1={p.cy}
            x2={p.cx + p.r * 0.82}
            y2={p.cy - p.r * 0.48}
            stroke="var(--ts-surface)"
            strokeWidth="3"
            opacity="0.85"
          />
        </g>
      ))}
    </svg>
  );
}
