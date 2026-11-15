"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { installErrorReporter } from "@/lib/error-reporter";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } }),
  );
  useEffect(() => installErrorReporter(), []);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
