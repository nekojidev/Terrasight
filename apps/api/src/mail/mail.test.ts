import net from "node:net";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../config/config.js";
import { linkExpiry } from "../reports/reports.service.js";
import { Mailer, linkIn } from "./mailer.js";
import { buildMessage, smtpSend } from "./smtp.js";
import { templates } from "./templates.js";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  RABBITMQ_URL: "amqp://localhost",
  JWT_SECRET: "x".repeat(32),
};

describe("Mailer without SMTP_URL", () => {
  it("writes the email to uploads/outbox and finds the latest for a recipient", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ts-mail-"));
    const mailer = new Mailer(loadEnv({ ...base, UPLOADS_DIR: dir }));
    await mailer.send({ to: "a@example.com", subject: "S", text: "go https://x.test/verify/abc now" });
    await mailer.send({ to: "a@example.com", subject: "S2", text: "go https://x.test/reset/def" });
    expect(readdirSync(join(dir, "outbox"))).toHaveLength(2);
    const latest = mailer.latestFor("A@example.com")!;
    expect(linkIn(latest.text)).toBe("https://x.test/reset/def");
    expect(mailer.latestFor("b@example.com")).toBeNull();
    const file = readdirSync(join(dir, "outbox"))[0]!;
    expect(JSON.parse(readFileSync(join(dir, "outbox", file), "utf8")).to).toBe("a@example.com");
  });
});

describe("config", () => {
  it("production requires SMTP_URL and refuses test hooks", () => {
    expect(() => loadEnv({ ...base, NODE_ENV: "production" })).toThrow(/SMTP_URL/);
    expect(() =>
      loadEnv({ ...base, NODE_ENV: "production", SMTP_URL: "smtps://u:p@h:465", AUTH_TEST_HOOKS: "1" }),
    ).toThrow(/AUTH_TEST_HOOKS/);
    expect(loadEnv({ ...base, NODE_ENV: "production", SMTP_URL: "smtps://u:p@h:465" }).MAX_WORKSPACES_PER_USER).toBe(5);
  });
});

describe("templates", () => {
  it("have EN and UK copy that carry the link", () => {
    for (const lang of ["en", "uk"] as const) {
      expect(templates.verify(lang, "Ira", "https://x/verify/t").text).toContain("https://x/verify/t");
      expect(templates.reset(lang, "https://x/reset/t").text).toContain("https://x/reset/t");
      expect(templates.invitation(lang, "Co", "https://x/invite/t").text).toContain("https://x/invite/t");
      expect(templates.alreadyRegistered(lang, "https://x/login").text).not.toMatch(/verify/);
    }
    expect(templates.reset("uk", "l").subject).toMatch(/пароля/);
  });
});

describe("SMTP client", () => {
  it("builds a header-injection-safe MIME message", () => {
    const raw = buildMessage({ from: "T <a@b.c>", to: "x@y.z\r\nBcc: evil@e.com", subject: "Hi\r\nBcc: e", text: "é\n.dot" });
    expect(raw.split("\r\n").some((l) => l.startsWith("Bcc:"))).toBe(false);
    expect(raw).toContain("Content-Transfer-Encoding: base64");
  });

  it("talks to a plain SMTP server: EHLO, AUTH, MAIL, RCPT, DATA", async () => {
    const seen: string[] = [];
    const server = net.createServer((s) => {
      s.write("220 hi\r\n");
      let data = false;
      s.on("data", (d) => {
        for (const line of d.toString().split("\r\n").filter(Boolean)) {
          if (data) {
            if (line === ".") {
              data = false;
              s.write("250 queued\r\n");
            }
            continue;
          }
          seen.push(line.split(" ").slice(0, 2).join(" "));
          if (line.startsWith("EHLO")) s.write("250-localhost\r\n250 AUTH PLAIN\r\n");
          else if (line.startsWith("AUTH")) s.write("235 ok\r\n");
          else if (line.startsWith("MAIL") || line.startsWith("RCPT")) s.write("250 ok\r\n");
          else if (line === "DATA") {
            data = true;
            s.write("354 go\r\n");
          } else if (line === "QUIT") s.end("221 bye\r\n");
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;
    await smtpSend(`smtp://user:pw@127.0.0.1:${port}`, { from: "T <a@b.c>", to: "x@y.z", subject: "S", text: "hi" });
    server.close();
    expect(seen).toEqual(["EHLO terrasight.app", "AUTH PLAIN", "MAIL FROM:<a@b.c>", "RCPT TO:<x@y.z>", "DATA", "QUIT"]);
  });
});

describe("report link expiry", () => {
  const now = Date.parse("2026-11-15T00:00:00Z");
  it("defaults to 60 days, caps at a year, refuses the past", () => {
    expect(linkExpiry(undefined, now).getTime() - now).toBe(60 * 864e5);
    expect(linkExpiry(null, now).getTime() - now).toBe(60 * 864e5);
    expect(linkExpiry("2028-01-01T00:00:00Z", now).getTime() - now).toBe(365 * 864e5);
    expect(linkExpiry("2026-12-01T00:00:00Z", now).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(() => linkExpiry("2026-11-01T00:00:00Z", now)).toThrow();
  });
});
