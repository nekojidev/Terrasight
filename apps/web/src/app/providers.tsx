"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@terrasight/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { AssistantBusProvider } from "@/components/AssistantBus";
import { installErrorReporter } from "@/lib/error-reporter";

export function Providers({ children }: { children: ReactNode }) {
  const t = useTranslations("App");
  const [client] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } }),
  );
  useEffect(() => installErrorReporter(), []);
  return (
    <QueryClientProvider client={client}>
      <ToastProvider dismissLabel={t("toastDismiss")}>
        <AssistantBusProvider>{children}</AssistantBusProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
