import { describe, expect, it } from "vitest";
import { EventKeys, matchesPattern, StreamTopic, topicPattern } from "./events.js";

const WS = "11111111-1111-4111-8111-111111111111";
const FIELD = "22222222-2222-4222-8222-222222222222";

describe("matchesPattern", () => {
  it.each([
    ["field.a.#", "field.a.gather.power", true],
    ["field.a.#", "field.a", true],
    ["field.a.#", "field.b.gather.power", false],
    ["workspace.*.brief", "workspace.x.brief", true],
    ["workspace.*.brief", "workspace.x.analysis", false],
    ["#", "anything.at.all", true],
  ])("%s ~ %s = %s", (pattern, key, expected) => {
    expect(matchesPattern(pattern, key)).toBe(expected);
  });
});

describe("stream topics", () => {
  it("accepts known topics only", () => {
    expect(StreamTopic.safeParse("brief").success).toBe(true);
    expect(StreamTopic.safeParse(`field:${FIELD}`).success).toBe(true);
    expect(StreamTopic.safeParse("field:../../etc").success).toBe(false);
    expect(StreamTopic.safeParse("everything").success).toBe(false);
  });

  it("maps topics to the routing keys producers use", () => {
    expect(matchesPattern(topicPattern("brief", WS), EventKeys.brief(WS))).toBe(true);
    expect(matchesPattern(topicPattern(`field:${FIELD}`, WS), EventKeys.fieldGather(FIELD, "power"))).toBe(
      true,
    );
    expect(matchesPattern(topicPattern("analysis", WS), EventKeys.brief(WS))).toBe(false);
  });
});
