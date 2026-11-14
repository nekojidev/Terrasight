import { EventKeys } from "@terrasight/shared";
import { firstValueFrom, take, toArray } from "rxjs";
import { describe, expect, it } from "vitest";
import { FakeBroker } from "../messaging/fake-broker.js";
import { envelope } from "../messaging/outbox.js";
import { EventsService, type StreamEvent } from "./events.service.js";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const FIELD = "22222222-2222-4222-8222-222222222222";

async function service() {
  const s = new EventsService(new FakeBroker());
  await s.onModuleInit();
  return s;
}

describe("EventsService (RFC §5.3)", () => {
  it("sends the current state first, then live events", async () => {
    const s = await service();
    s.registerStateProvider("brief", async () => ({ hero: "pivot-14" }));
    const got = firstValueFrom(s.stream(WS, ["brief"], 60_000).pipe(take(2), toArray()));
    await new Promise((r) => setTimeout(r, 5));
    s.push(EventKeys.brief(WS), envelope("brief.changed", WS, { n: 1 }));
    const events = await got;
    expect(events[0]).toEqual({ type: "brief", data: { state: { hero: "pivot-14" } } });
    expect(events[1]?.type).toBe("brief");
  });

  it("never forwards another workspace's events", async () => {
    const s = await service();
    const seen: StreamEvent[] = [];
    const sub = s.stream(WS, ["brief", `field:${FIELD}`], 60_000).subscribe((e) => seen.push(e));
    s.push(EventKeys.brief(OTHER), envelope("brief.changed", OTHER, {}));
    s.push(EventKeys.fieldGather(FIELD, "power"), envelope("gather.progress", OTHER, {}));
    s.push(EventKeys.fieldGather(FIELD, "power"), envelope("gather.progress", WS, { status: "done" }));
    sub.unsubscribe();
    expect(seen.map((e) => e.type)).toEqual([`field:${FIELD}`]);
  });

  it("only forwards subscribed topics and sends heartbeats", async () => {
    const s = await service();
    const seen: StreamEvent[] = [];
    const sub = s.stream(WS, ["analysis"], 10).subscribe((e) => seen.push(e));
    s.push(EventKeys.brief(WS), envelope("brief.changed", WS, {}));
    await new Promise((r) => setTimeout(r, 35));
    sub.unsubscribe();
    expect(seen.every((e) => e.type === "ping")).toBe(true);
    expect(seen.length).toBeGreaterThanOrEqual(2);
  });
});
