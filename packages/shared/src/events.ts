import { z } from "zod";

/**
 * Message envelope for jobs and events (Tech Design §7). Every message has an id for idempotency.
 * Events always carry the workspace id, so the SSE stream can filter them per workspace.
 */
export const Envelope = z.object({
  id: z.string().uuid(),
  type: z.string().min(1),
  occurredAt: z.string().datetime(),
  workspaceId: z.string().uuid().nullable(),
  data: z.unknown(),
});
export type Envelope<T = unknown> = Omit<z.infer<typeof Envelope>, "data"> & { data: T };

/** Routing keys on the `terrasight.events` topic exchange. */
export const EventKeys = {
  fieldGather: (fieldId: string, source: string) => `field.${fieldId}.gather.${source}`,
  fieldHistory: (fieldId: string) => `field.${fieldId}.history`,
  analysis: (workspaceId: string) => `workspace.${workspaceId}.analysis`,
  brief: (workspaceId: string) => `workspace.${workspaceId}.brief`,
  conversation: (conversationId: string) => `conversation.${conversationId}.answer`,
  notifications: (workspaceId: string, userId: string) => `workspace.${workspaceId}.notifications.${userId}`,
} as const;

/**
 * Topics a browser can subscribe to on the SSE stream:
 * `brief`, `analysis`, `notifications` (the caller's own), `field:<uuid>`, `conversation:<uuid>`.
 */
export const StreamTopic = z.union([
  z.literal("brief"),
  z.literal("analysis"),
  z.literal("notifications"),
  z.string().regex(/^field:[0-9a-f-]{36}$/),
  z.string().regex(/^conversation:[0-9a-f-]{36}$/),
]);
export type StreamTopic = z.infer<typeof StreamTopic>;

/** The routing-key pattern (AMQP topic syntax) a stream topic listens to. */
export function topicPattern(topic: StreamTopic, workspaceId: string, userId?: string): string {
  if (topic === "brief") return `workspace.${workspaceId}.brief`;
  if (topic === "analysis") return `workspace.${workspaceId}.analysis`;
  if (topic === "notifications") return `workspace.${workspaceId}.notifications.${userId ?? "none"}`;
  const [kind, id] = topic.split(":");
  return kind === "field" ? `field.${id}.#` : `conversation.${id}.answer`;
}

/** AMQP topic match: `*` = one word, `#` = zero or more words. */
export function matchesPattern(pattern: string, key: string): boolean {
  const p = pattern.split(".");
  const k = key.split(".");
  const walk = (i: number, j: number): boolean => {
    if (i === p.length) return j === k.length;
    if (p[i] === "#") {
      for (let n = j; n <= k.length; n++) if (walk(i + 1, n)) return true;
      return false;
    }
    if (j === k.length) return false;
    return (p[i] === "*" || p[i] === k[j]) && walk(i + 1, j + 1);
  };
  return walk(0, 0);
}
