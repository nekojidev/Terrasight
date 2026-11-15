import { Surface } from "@terrasight/ui";
import type { ReactNode } from "react";
import { Brand } from "@/components/Brand";
import { LanguageSwitch } from "@/components/LanguageSwitch";

/** Shared frame of the small auth pages (forgot, reset, setup link): brand, language, one card. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col gap-6 px-4 py-10">
      <header className="flex items-center justify-between">
        <Brand />
        <LanguageSwitch />
      </header>
      <Surface as="section" pad="lg" className="sm:p-8">
        <div className="flex flex-col gap-5">{children}</div>
      </Surface>
    </main>
  );
}

/** A link that looks like the one primary button (a link cannot be a `Button`). */
export const primaryLink =
  "focus-ring inline-flex min-h-14 items-center justify-center rounded-btn bg-ink px-6 text-body font-semibold text-surface hover:opacity-90";
/** A quiet text link with a 44 px target. */
export const quietLink =
  "focus-ring inline-flex min-h-tap items-center justify-center self-center px-2 text-body font-semibold text-ink-2 underline underline-offset-4";
