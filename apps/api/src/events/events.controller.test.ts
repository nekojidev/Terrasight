import { ForbiddenException } from "@nestjs/common";
import { firstValueFrom, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import type { AuthedRequest } from "../auth/current-user.js";
import { EventsController } from "./events.controller.js";

const WS = "11111111-1111-4111-8111-111111111111";
const CONV = "33333333-3333-4333-8333-333333333333";
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function setup() {
  const findFirst = vi.fn(async ({ where }: { where: { id: string; workspaceId: string; userId: string } }) =>
    where.id === CONV && where.workspaceId === WS && where.userId === OWNER ? { id: CONV } : null,
  );
  const stream = vi.fn(() => of({ type: "answer", data: { x: 1 } }));
  const ctrl = new EventsController({ stream } as never, { system: { conversation: { findFirst } } } as never);
  const req = (id: string) => ({ user: { id } }) as AuthedRequest;
  return { ctrl, stream, req };
}

describe("EventsController conversation topics", () => {
  it("lets the conversation owner subscribe", async () => {
    const { ctrl, req } = setup();
    const obs = await ctrl.stream(WS, `conversation:${CONV}`, req(OWNER));
    expect((await firstValueFrom(obs)).type).toBe("answer");
  });

  it("rejects another workspace member with 403 and opens no stream", async () => {
    const { ctrl, stream, req } = setup();
    await expect(ctrl.stream(WS, `conversation:${CONV}`, req(OTHER))).rejects.toBeInstanceOf(ForbiddenException);
    expect(stream).not.toHaveBeenCalled();
  });

  it("rejects an unknown conversation", async () => {
    const { ctrl, req } = setup();
    const other = "44444444-4444-4444-8444-444444444444";
    await expect(ctrl.stream(WS, `conversation:${other}`, req(OWNER))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
