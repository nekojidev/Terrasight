"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { clearActive, latestForFieldPath, pickActive, readActive, writeActive } from "@/lib/assistant-context";

/**
 * The assistant thread of one field (S-05.05): this tab's remembered choice, else the server's latest chat of this
 * user for the field. Leaving the field page and coming back restores the thread; `forget` starts from nothing.
 */
export function useActiveConversation(workspaceId: string, fieldId: string) {
  const client = useQueryClient();
  // sessionStorage is read after mount so the server and first client render agree.
  const [stored, setStored] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setStored(readActive(workspaceId, fieldId));
    setReady(true);
  }, [workspaceId, fieldId]);

  const latestKey = ["conversations", workspaceId, "latest", fieldId];
  const latest = useQuery({
    queryKey: latestKey,
    queryFn: async () => (await api<Array<{ id: string }>>(latestForFieldPath(workspaceId, fieldId)))[0]?.id ?? null,
    enabled: ready && !stored,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const select = useCallback(
    (id: string) => {
      writeActive(workspaceId, fieldId, id);
      setStored(id);
      client.setQueryData(["conversations", workspaceId, "latest", fieldId], id);
      void client.invalidateQueries({ queryKey: ["conversations", workspaceId], exact: true });
    },
    [client, workspaceId, fieldId],
  );
  /** Drops the remembered thread (it was deleted, or the user chose a clean start). */
  const forget = useCallback(() => {
    clearActive(workspaceId, fieldId);
    setStored(null);
    client.removeQueries({ queryKey: ["conversations", workspaceId, "latest", fieldId] });
  }, [client, workspaceId, fieldId]);

  return {
    id: ready ? pickActive(stored, latest.data) : null,
    /** True until we know whether this field already has a thread. */
    loading: !ready || (!stored && latest.isPending && !latest.isError),
    select,
    forget,
  };
}
