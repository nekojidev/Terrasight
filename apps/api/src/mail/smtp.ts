import { randomUUID } from "node:crypto";
import net from "node:net";
import tls from "node:tls";

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

/** Strips CR/LF so a value can never start a new header or SMTP command. */
const oneLine = (v: string) => v.replace(/[\r\n]+/g, " ").trim();
const addrOf = (v: string) => /<([^>]+)>/.exec(v)?.[1] ?? oneLine(v);

export function buildMessage(m: MailMessage, host = "terrasight.app"): string {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
  const wrapped = b64(m.text).replace(/(.{76})/g, "$1\r\n");
  return [
    `From: ${oneLine(m.from)}`,
    `To: ${oneLine(m.to)}`,
    `Subject: =?UTF-8?B?${b64(oneLine(m.subject))}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${host}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapped,
  ].join("\r\n");
}

/** A reader of SMTP replies (handles multi-line "250-" continuations). */
class Replies {
  private buf = "";
  private waiters: Array<(r: { code: number; text: string }) => void> = [];
  private queue: Array<{ code: number; text: string }> = [];
  private lines: string[] = [];
  constructor(private socket: net.Socket) {
    this.attach(socket);
  }
  attach(socket: net.Socket): void {
    this.socket = socket;
    socket.on("data", (d: Buffer) => {
      this.buf += d.toString("utf8");
      let i: number;
      while ((i = this.buf.indexOf("\r\n")) !== -1) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 2);
        this.lines.push(line);
        if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
          const r = { code: Number(line.slice(0, 3)), text: this.lines.join("\n") };
          this.lines = [];
          const w = this.waiters.shift();
          if (w) w(r);
          else this.queue.push(r);
        }
      }
    });
  }
  next(): Promise<{ code: number; text: string }> {
    const q = this.queue.shift();
    return q ? Promise.resolve(q) : new Promise((res) => this.waiters.push(res));
  }
}

/** Minimal SMTP client (AUTH PLAIN, STARTTLS or implicit TLS): enough for SES/Postmark-style relays, no dependency. */
export async function smtpSend(smtpUrl: string, m: MailMessage, timeoutMs = 20_000): Promise<void> {
  const u = new URL(smtpUrl);
  const secure = u.protocol === "smtps:";
  const port = Number(u.port) || (secure ? 465 : 587);
  const host = u.hostname;
  let socket: net.Socket = await new Promise((resolve, reject) => {
    const s = secure
      ? tls.connect({ host, port, servername: host }, () => resolve(s))
      : net.connect({ host, port }, () => resolve(s));
    s.once("error", reject);
  });
  const timer = setTimeout(() => socket.destroy(new Error("smtp timeout")), timeoutMs);
  const replies = new Replies(socket);
  const expect = async (ok: number[]) => {
    const r = await replies.next();
    if (!ok.includes(r.code)) throw new Error(`smtp ${r.code}`);
    return r;
  };
  const cmd = async (line: string, ok: number[]) => {
    socket.write(`${line}\r\n`);
    return expect(ok);
  };
  try {
    await expect([220]);
    let caps = (await cmd("EHLO terrasight.app", [250])).text;
    if (!secure && /STARTTLS/i.test(caps)) {
      await cmd("STARTTLS", [220]);
      const upgraded = tls.connect({ socket, servername: host });
      await new Promise<void>((res, rej) => {
        upgraded.once("secureConnect", res);
        upgraded.once("error", rej);
      });
      socket = upgraded;
      replies.attach(upgraded);
      caps = (await cmd("EHLO terrasight.app", [250])).text;
    }
    if (u.username) {
      const user = decodeURIComponent(u.username);
      const pass = decodeURIComponent(u.password);
      const token = Buffer.from(`\0${user}\0${pass}`).toString("base64");
      await cmd(`AUTH PLAIN ${token}`, [235]);
    }
    await cmd(`MAIL FROM:<${addrOf(m.from)}>`, [250]);
    await cmd(`RCPT TO:<${addrOf(m.to)}>`, [250, 251]);
    await cmd("DATA", [354]);
    const body = buildMessage(m).replace(/^\./gm, "..");
    await cmd(`${body}\r\n.`, [250]);
    await cmd("QUIT", [221]).catch(() => undefined);
  } finally {
    clearTimeout(timer);
    socket.destroy();
  }
}
