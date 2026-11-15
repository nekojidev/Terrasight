import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ENV, type Env } from "../config/config.js";
import { smtpSend } from "./smtp.js";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends email over SMTP (SMTP_URL). Without SMTP_URL (development and tests only; production refuses to start)
 * each email is written as JSON to `<UPLOADS_DIR>/outbox/` (gitignored). The link is never logged.
 */
@Injectable()
export class Mailer {
  private readonly log = new Logger(Mailer.name);
  constructor(@Inject(ENV) private readonly env: Env) {}

  get outboxDir(): string {
    return join(this.env.UPLOADS_DIR, "outbox");
  }

  async send(mail: Mail): Promise<void> {
    if (this.env.SMTP_URL) {
      await smtpSend(this.env.SMTP_URL, { from: this.env.EMAIL_FROM, ...mail });
      return;
    }
    mkdirSync(this.outboxDir, { recursive: true, mode: 0o700 });
    const name = `${Date.now()}-${randomUUID().slice(0, 8)}.json`;
    writeFileSync(
      join(this.outboxDir, name),
      JSON.stringify({ from: this.env.EMAIL_FROM, ...mail, at: new Date().toISOString() }, null, 2),
      { mode: 0o600 },
    );
    this.log.debug(`email to outbox: ${name}`);
  }

  /** Fire-and-forget safe: a failed send is logged (no content) and never reaches the HTTP caller. */
  async trySend(mail: Mail): Promise<void> {
    try {
      await this.send(mail);
    } catch (e) {
      this.log.error(`email send failed: ${(e as Error).message}`);
    }
  }

  /** Latest outbox email for a recipient (development / test hooks only). */
  latestFor(to: string): (Mail & { at: string }) | null {
    let files: string[];
    try {
      files = readdirSync(this.outboxDir).filter((f) => f.endsWith(".json")).sort();
    } catch {
      return null;
    }
    for (const f of files.reverse()) {
      try {
        const m = JSON.parse(readFileSync(join(this.outboxDir, f), "utf8")) as Mail & { at: string };
        if (m.to.toLowerCase() === to.toLowerCase()) return m;
      } catch {
        // unreadable file: skip
      }
    }
    return null;
  }
}

/** The first URL in an email body (the password-reset link). */
export function linkIn(text: string): string | null {
  return /https?:\/\/\S+/.exec(text)?.[0] ?? null;
}
