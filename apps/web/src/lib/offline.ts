"use client";

import { useSyncExternalStore } from "react";

function subscribe(cb: () => void): () => void {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** True unless the browser reports no connection (server render assumes online). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

export interface ScoutDraft {
  counts: Array<number | null>;
  clientId: string;
  /** Send was tapped offline: send automatically when the connection is back. */
  queued?: boolean;
}

export const draftKey = (taskId: string) => `ts.scout.${taskId}`;

export function loadDraft(taskId: string): ScoutDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(taskId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<ScoutDraft>;
    if (!Array.isArray(d.counts) || typeof d.clientId !== "string") return null;
    return { counts: d.counts, clientId: d.clientId, queued: d.queued === true };
  } catch {
    return null;
  }
}

export function saveDraft(taskId: string, draft: ScoutDraft): void {
  try {
    localStorage.setItem(draftKey(taskId), JSON.stringify(draft));
  } catch {
    /* storage unavailable */
  }
}

export function clearDraft(taskId: string): void {
  try {
    localStorage.removeItem(draftKey(taskId));
  } catch {
    /* storage unavailable */
  }
}
