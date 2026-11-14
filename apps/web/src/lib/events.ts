"use client";

import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { StreamTopic } from "@terrasight/shared";
import { useEffect, useRef } from "react";

export const POLL_MS = 5_000;
export const MAX_FAILURES_BEFORE_POLLING = 3;

/** Query keys each stream topic invalidates. Feature epics register theirs. */
export type TopicKeys = (topic: StreamTopic, workspaceId: string) => QueryKey[];

export const defaultTopicKeys: TopicKeys = (topic, ws) => {
  if (topic === "brief") return [["brief", ws]];
  if (topic === "analysis")
    return [
      ["analysis", ws],
      ["brief", ws],
    ];
  if (topic === "notifications") return [["notifications", ws]];
  const [kind, id] = topic.split(":");
  return kind === "field" ? [["field", ws, id]] : [["conversation", ws, id]];
};

type EventSourceLike = Pick<EventSource, "addEventListener" | "close"> & {
  onerror: ((e: Event) => void) | null;
  onopen: ((e: Event) => void) | null;
};
export type EventSourceFactory = (url: string) => EventSourceLike;

const browserFactory: EventSourceFactory = (url) => new EventSource(url, { withCredentials: true });

export interface StreamController {
  stop(): void;
  readonly polling: boolean;
}

/**
 * Connects to `/api/w/:ws/events` and invalidates the matching queries on each event (S-00.05).
 * EventSource reconnects by itself; after MAX_FAILURES_BEFORE_POLLING consecutive errors we give up on SSE
 * and poll (invalidate every POLL_MS) instead, as RFC §4 requires a polling fallback.
 */
export function connectStream(opts: {
  workspaceId: string;
  topics: StreamTopic[];
  invalidate: (key: QueryKey) => void;
  topicKeys?: TopicKeys;
  factory?: EventSourceFactory;
  onEvent?: (topic: string, data: unknown) => void;
}): StreamController {
  const { workspaceId, topics, invalidate, topicKeys = defaultTopicKeys, factory = browserFactory } = opts;
  const url = `/api/w/${workspaceId}/events?topics=${encodeURIComponent(topics.join(","))}`;
  let failures = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let source: EventSourceLike | null = factory(url);

  const refreshAll = () => topics.forEach((t) => topicKeys(t, workspaceId).forEach((k) => invalidate(k)));

  const startPolling = () => {
    source?.close();
    source = null;
    if (!pollTimer) pollTimer = setInterval(refreshAll, POLL_MS);
  };

  source.onopen = () => {
    failures = 0;
  };
  source.onerror = () => {
    failures += 1;
    if (failures >= MAX_FAILURES_BEFORE_POLLING) startPolling();
  };
  for (const topic of topics) {
    source.addEventListener(topic, (e: Event) => {
      const data = JSON.parse((e as MessageEvent<string>).data) as unknown;
      topicKeys(topic, workspaceId).forEach((k) => invalidate(k));
      opts.onEvent?.(topic, data);
    });
  }

  return {
    stop() {
      source?.close();
      if (pollTimer) clearInterval(pollTimer);
    },
    get polling() {
      return pollTimer !== null;
    },
  };
}

/** React hook around connectStream; reconnects when the workspace or topics change. */
export function useWorkspaceEvents(workspaceId: string | null, topics: StreamTopic[], topicKeys?: TopicKeys) {
  const client = useQueryClient();
  const keyRef = useRef(topicKeys);
  keyRef.current = topicKeys;
  const topicList = topics.join(",");
  useEffect(() => {
    if (!workspaceId) return;
    const ctl = connectStream({
      workspaceId,
      topics: topicList.split(",") as StreamTopic[],
      invalidate: (queryKey) => void client.invalidateQueries({ queryKey }),
      topicKeys: keyRef.current,
    });
    return () => ctl.stop();
  }, [workspaceId, topicList, client]);
}
