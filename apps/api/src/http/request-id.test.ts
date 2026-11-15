import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { requestId } from "./request-id.js";

function run(header?: string) {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
  } as unknown as ServerResponse;
  const req = { headers: header ? { "x-request-id": header } : {} } as unknown as IncomingMessage;
  return { id: requestId(req, res), headers };
}

describe("requestId", () => {
  it("generates an id and sets the response header", () => {
    const { id, headers } = run();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers["X-Request-Id"]).toBe(id);
  });
  it("keeps a sane incoming id", () => expect(run("abc-123_XYZ.9").id).toBe("abc-123_XYZ.9"));
  it("replaces an unsafe incoming id", () => expect(run("bad id\nx").id).toMatch(/^[0-9a-f-]{36}$/));
});
