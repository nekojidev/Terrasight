import { describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";

function res(status: number, body?: unknown, problem = false): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": problem ? "application/problem+json" : "application/json" },
  });
}

describe("api client", () => {
  it("sends the CSRF header and JSON body", async () => {
    const f = vi.fn(async () => res(200, { ok: true }));
    await api("/api/x", { body: { a: 1 }, fetchImpl: f as unknown as typeof fetch });
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("XMLHttpRequest");
    expect(init.body).toBe('{"a":1}');
  });

  it("refreshes once on 401 and retries", async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string) => {
      calls.push(url);
      if (url === "/api/auth/refresh") return res(204);
      return calls.filter((c) => c === "/api/me").length === 1
        ? res(401, { status: 401 }, true)
        : res(200, { id: "u1" });
    });
    expect(await api("/api/me", { fetchImpl: f as unknown as typeof fetch })).toEqual({ id: "u1" });
    expect(calls).toEqual(["/api/me", "/api/auth/refresh", "/api/me"]);
  });

  it("shares one refresh between concurrent 401s (a second rotation would look like token reuse)", async () => {
    let refreshes = 0;
    const seen = new Map<string, number>();
    const f = vi.fn(async (url: string) => {
      if (url === "/api/auth/refresh") {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 5));
        return res(204);
      }
      const n = (seen.get(url) ?? 0) + 1;
      seen.set(url, n);
      return n === 1 ? res(401, { status: 401 }, true) : res(200, { url });
    });
    await Promise.all(
      ["/api/a", "/api/b", "/api/c"].map((u) => api(u, { fetchImpl: f as unknown as typeof fetch })),
    );
    expect(refreshes).toBe(1);
  });

  it("throws ApiError with the problem code and field errors", async () => {
    const f = vi.fn(async () =>
      res(
        422,
        {
          type: "https://terrasight.app/problems/invalid-input",
          title: "Invalid input",
          status: 422,
          errors: [{ path: "email", message: "bad" }],
        },
        true,
      ),
    );
    const err = (await api("/api/x", { body: {}, fetchImpl: f as unknown as typeof fetch }).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("invalid-input");
    expect(err.field("email")).toBe("bad");
  });

  it("doesn't loop when the refresh fails", async () => {
    const f = vi.fn(async (url: string) =>
      url === "/api/auth/refresh"
        ? res(401, { status: 401 }, true)
        : res(401, { status: 401, type: "x/unauth", title: "" }, true),
    );
    await expect(api("/api/me", { fetchImpl: f as unknown as typeof fetch })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(f).toHaveBeenCalledTimes(2);
  });
});
