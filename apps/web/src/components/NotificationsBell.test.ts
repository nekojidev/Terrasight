import { describe, expect, it } from "vitest";
import { groupNotifications, notificationHref, type NotificationItem } from "./NotificationsBell";

const n = (id: string, readAt: string | null, field = "Pivot 14"): NotificationItem => ({
  id,
  kind: "urgent_recommendation",
  payload: { fieldName: field, recommendationId: "r1" },
  createdAt: "2026-11-15T10:00:00Z",
  readAt,
});

describe("groupNotifications", () => {
  it("collapses identical rows into one with a count and an unread tally", () => {
    const g = groupNotifications(
      [n("1", null), n("2", null), n("3", "x"), n("4", null, "Other")],
      (x) => String(x.payload.fieldName),
    );
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ count: 3, unread: 2, ids: ["1", "2", "3"] });
    expect(g.reduce((s, x) => s + x.unread, 0)).toBe(3);
  });
  it("links decisions asked to /decisions", () => {
    expect(notificationHref({ kind: "decision_asked", payload: {} })).toBe("/decisions");
  });
});
