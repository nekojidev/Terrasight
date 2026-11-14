import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { GoogleGenAI, type Content, type Part } from "@google/genai";
import {
  AllowedSet,
  checkSentence,
  classifyRefusal,
  createSafetyFilter,
  fixHorizon,
  functionDeclarations,
  isTool,
  parseActives,
  progressText,
  REFUSALS,
  splitSentences,
  systemPrompt,
  type SafetyFilter,
} from "@terrasight/assistant-core";
import { EventKeys } from "@terrasight/shared";
import { localDate } from "../analysis/scheduler.js";
import { RateLimitService } from "../auth/rate-limit.js";
import { ENV, runsScheduler, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import { EventsService } from "../events/events.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { ProblemException } from "../http/problem.js";
import { eventRow } from "../messaging/outbox.js";
import { OutboxService } from "../messaging/outbox.service.js";
import { ToolError, ToolExecutor, type Scope } from "./executor.js";

const MAX_TOOL_CALLS = 6;
const TURN_MS = 30_000;
const RETENTION_DAYS = 90;
const USER_BUCKET = { capacity: 10, refillPerSec: 1 / 6 };
const WORKSPACE_BUCKET = { capacity: 30, refillPerSec: 1 / 2 };

export const UNAVAILABLE: Record<"en" | "uk", string> = {
  en: "Assistant unavailable. The brief, cards and report keep working.",
  uk: "Асистент недоступний. Бриф, картки та звіт працюють.",
};
const SHOWING_DATA: Record<"en" | "uk", string> = {
  en: "Showing the data directly.",
  uk: "Показуємо дані напряму.",
};

/** Replaces the company's field names in free text with their aliases F<n>, longest names first, case-insensitive. */
export function pseudonymise(text: string, aliases: Map<string, { name: string }>): string {
  const pairs = [...aliases.entries()]
    .filter(([, f]) => f.name.trim().length > 0)
    .sort((a, b) => b[1].name.length - a[1].name.length);
  let out = text;
  for (const [alias, f] of pairs) {
    const escaped = f.name
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"), alias);
  }
  return out;
}

interface ToolRun {
  tool: string;
  args: unknown;
  result: unknown;
  durationMs: number;
}

/** AI assistant (RFC D9, Tech Design §12): Gemini with read-only tools; every sentence passes the number check. */
@Injectable()
export class AssistantService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AssistantService.name);
  private readonly ai: GoogleGenAI | null;
  private readonly safety: SafetyFilter;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly events: EventsService,
    private readonly limits: RateLimitService,
    private readonly executor: ToolExecutor,
  ) {
    this.ai = env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }) : null;
    let actives: string[] = [];
    try {
      actives = parseActives(readFileSync(join(env.DATA_DIR, "safety", "actives.txt"), "utf8"));
    } catch {
      this.log.warn("data/safety/actives.txt missing: only dose patterns are filtered");
    }
    this.safety = createSafetyFilter(actives);
  }

  onModuleInit(): void {
    this.events.registerStateProvider("conversation", async (workspaceId, topic) => {
      const id = topic.slice("conversation:".length);
      return this.get(workspaceId, id).catch(() => undefined);
    });
    if (runsScheduler(this.env) && this.env.NODE_ENV !== "test") {
      this.timer = setInterval(() => void this.purge(), 6 * 3600_000);
      setTimeout(() => void this.purge(), 30_000);
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Retention (RFC §12.7): conversations expire 90 days after creation; messages and tool calls cascade. */
  async purge(now = new Date()): Promise<number> {
    const r = await this.prisma.system.conversation.deleteMany({ where: { expiresAt: { lt: now } } });
    if (r.count) this.log.log(`deleted ${r.count} expired conversation(s)`);
    return r.count;
  }

  async create(workspaceId: string, userId: string, title?: string) {
    const c = await this.prisma.system.conversation.create({
      data: {
        workspaceId,
        userId,
        title: title ?? null,
        expiresAt: new Date(Date.now() + RETENTION_DAYS * 864e5),
      },
    });
    return { id: c.id, title: c.title, createdAt: c.createdAt, expiresAt: c.expiresAt };
  }

  async list(workspaceId: string, userId: string) {
    const rows = await this.prisma.system.conversation.findMany({
      where: { workspaceId, userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { messages: { orderBy: { createdAt: "asc" }, take: 1, select: { text: true } } },
    });
    return rows.map((c) => ({
      id: c.id,
      title: c.title ?? c.messages[0]?.text.slice(0, 80) ?? null,
      createdAt: c.createdAt,
    }));
  }

  private async own(workspaceId: string, userId: string | null, id: string) {
    const c = await this.prisma.system.conversation.findFirst({
      where: { id, workspaceId, ...(userId ? { userId } : {}) },
    });
    if (!c) throw new ProblemException(404, "not-found");
    return c;
  }

  /** The conversation with its messages and the alias → field name map the UI uses to restore names. */
  async get(workspaceId: string, id: string, userId: string | null = null, includeResults = false) {
    const c = await this.own(workspaceId, userId, id);
    const messages = await this.prisma.system.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: "asc" },
      include: { toolCalls: true },
    });
    const aliases = Object.fromEntries(
      [...(await this.executor.aliases(workspaceId)).entries()].map(([a, f]) => [
        a,
        { id: f.id, name: f.name },
      ]),
    );
    return {
      id: c.id,
      title: c.title,
      expiresAt: c.expiresAt,
      aliases,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        checked: m.checked,
        fallback: m.fallback,
        numbersChecked: m.numbersChecked,
        card: m.card,
        error: m.error,
        createdAt: m.createdAt,
        tools: m.toolCalls.map((t) => ({
          tool: t.tool,
          args: t.args,
          durationMs: t.durationMs,
          ...(includeResults ? { result: t.result } : {}),
        })),
      })),
    };
  }

  async remove(workspaceId: string, userId: string, id: string): Promise<void> {
    await this.own(workspaceId, userId, id);
    await this.prisma.system.conversation.delete({ where: { id } });
  }

  /** POST /conversations/:id/messages → 202; the answer streams on `conversation.<id>.answer`. */
  async ask(
    scope: Scope,
    conversationId: string,
    text: string,
    context: { fieldId?: string; recommendationId?: string },
  ) {
    await this.own(scope.workspaceId, scope.userId, conversationId);
    const okUser = await this.limits.take(`assistant:user:${scope.userId}`, USER_BUCKET);
    const okWs = await this.limits.take(`assistant:ws:${scope.workspaceId}`, WORKSPACE_BUCKET);
    if (!okUser || !okWs)
      throw new ProblemException(429, "rate-limited", "Too many questions; try again in a minute");
    const user = await this.prisma.system.message.create({
      data: { conversationId, role: "user", text, context: context as Prisma.InputJsonValue },
    });
    const answer = await this.prisma.system.message.create({
      data: { conversationId, role: "assistant", text: "" },
    });
    void this.turn(scope, conversationId, answer.id, text, context).catch((e: unknown) =>
      this.log.error(`turn ${answer.id} failed: ${(e as Error).stack ?? String(e)}`),
    );
    return { userMessageId: user.id, messageId: answer.id };
  }

  private emit(scope: Scope, conversationId: string, type: string, data: Record<string, unknown>) {
    return this.outbox.add(this.prisma.system, [
      eventRow(EventKeys.conversation(conversationId), type, scope.workspaceId, data),
    ]);
  }

  /** One turn (Tech Design §12.1). */
  async turn(
    scope: Scope,
    conversationId: string,
    messageId: string,
    question: string,
    context: { fieldId?: string; recommendationId?: string },
  ): Promise<void> {
    const lang = scope.lang;
    const finish = async (
      data: {
        text: string;
        checked: boolean;
        fallback?: boolean;
        numbersChecked?: number;
        card?: unknown;
        error?: string | null;
      },
      runs: ToolRun[] = [],
    ) => {
      await this.prisma.system.$transaction(async (tx) => {
        await tx.message.update({
          where: { id: messageId },
          data: {
            text: data.text,
            checked: data.checked,
            fallback: data.fallback ?? false,
            numbersChecked: data.numbersChecked ?? 0,
            card: (data.card ?? undefined) as Prisma.InputJsonValue | undefined,
            error: data.error ?? null,
          },
        });
        if (runs.length)
          await tx.toolCall.createMany({
            data: runs.map((r) => ({
              messageId,
              tool: r.tool,
              args: r.args as Prisma.InputJsonValue,
              result: (r.result ?? null) as Prisma.InputJsonValue,
              durationMs: r.durationMs,
            })),
          });
      });
      await this.emit(scope, conversationId, "assistant.done", { messageId });
    };

    // Product, chemical-price and legal questions get a template, not the model (RFC §12.5).
    const refusal = classifyRefusal(question);
    if (refusal) return finish({ text: REFUSALS[refusal][lang], checked: true });
    if (!this.ai) return finish({ text: "", checked: false, error: UNAVAILABLE[lang] });

    // History: earlier finished messages of this conversation (text only, already checked).
    const earlier = await this.prisma.system.message.findMany({
      where: { conversationId, id: { not: messageId }, NOT: { text: "" } },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    // Field names the user typed become aliases before anything goes to Gemini (RFC §12.6).
    const aliases = await this.executor.aliases(scope.workspaceId);
    const contents: Content[] = earlier
      .slice(0, -1)
      .map((m) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: pseudonymise(m.text, aliases) }],
      }));
    question = pseudonymise(question, aliases);
    const ctx: string[] = [];
    if (context.fieldId) {
      const alias = [...aliases.entries()].find(([, f]) => f.id === context.fieldId)?.[0];
      if (alias) ctx.push(`The user is looking at field ${alias}.`);
    }
    if (context.recommendationId)
      ctx.push(`The user is looking at recommendation ${context.recommendationId}.`);
    contents.push({
      role: "user",
      parts: [{ text: ctx.length ? `${ctx.join(" ")}\n\n${question}` : question }],
    });

    const ws = await this.prisma.system.workspace.findUniqueOrThrow({
      where: { id: scope.workspaceId },
      select: { timeZone: true },
    });
    const signal = AbortSignal.timeout(TURN_MS);
    const runs: ToolRun[] = [];
    let answer = "";
    try {
      for (let step = 0; ; step++) {
        const withTools = runs.length < MAX_TOOL_CALLS;
        const resp = await this.ai.models.generateContent({
          model: this.env.GEMINI_MODEL,
          contents,
          config: {
            systemInstruction: systemPrompt(lang, localDate(ws.timeZone)),
            temperature: 0.2,
            abortSignal: signal,
            ...(withTools ? { tools: [{ functionDeclarations: functionDeclarations() }] } : {}),
          },
        });
        const calls = resp.functionCalls ?? [];
        if (!calls.length || !withTools) {
          answer = resp.text ?? "";
          break;
        }
        // Keep the model's turn as returned (thought signatures must go back unchanged).
        const modelContent = resp.candidates?.[0]?.content;
        if (modelContent) contents.push(modelContent);
        const responses: Part[] = [];
        for (const call of calls.slice(0, MAX_TOOL_CALLS - runs.length)) {
          const name = call.name ?? "";
          const args = (call.args ?? {}) as Record<string, unknown>;
          const t0 = Date.now();
          let result: unknown;
          if (!isTool(name)) result = { error: `unknown tool ${name}` };
          else {
            await this.emit(scope, conversationId, "assistant.progress", {
              messageId,
              text: progressText(name, args, lang),
            });
            try {
              result = await this.executor.run(name, args, scope);
            } catch (e) {
              result = { error: e instanceof ToolError ? e.message : "the tool failed" };
              if (!(e instanceof ToolError)) this.log.warn(`tool ${name} failed: ${(e as Error).message}`);
            }
          }
          runs.push({ tool: name, args, result, durationMs: Date.now() - t0 });
          responses.push({
            functionResponse: { name, ...(call.id ? { id: call.id } : {}), response: { result } },
          });
        }
        contents.push({ role: "user", parts: responses });
        if (step > MAX_TOOL_CALLS + 2) break;
      }
    } catch (e) {
      this.log.warn(`Gemini unavailable: ${(e as Error).message}`);
      return finish({ text: "", checked: false, error: UNAVAILABLE[lang] }, runs);
    }

    // Number check, then the safety filter, sentence by sentence (RFC §12.4–§12.5).
    const allowed = new AllowedSet();
    for (const r of runs) allowed.addResult(r.result);
    allowed.addText(question, lang);
    const shown: string[] = [];
    let numbers = 0;
    let failed = false;
    for (const raw of splitSentences(answer, lang)) {
      const check = checkSentence(raw, allowed, lang);
      if (!check.ok) {
        failed = true;
        this.log.warn(
          `number check failed (${check.failed.map((f) => f.raw).join(", ")}) in "${raw.trim().slice(0, 200)}": fallback for message ${messageId}`,
        );
        break;
      }
      numbers += check.numbers;
      const safe = this.safety.sentence(raw.trim(), lang);
      if (safe.blocked) this.log.warn(`safety filter: ${safe.blocked} in message ${messageId}`);
      const horizon = fixHorizon(safe.text, lang);
      if (horizon.changed) this.log.warn(`horizon wording rewritten in message ${messageId}`);
      shown.push(horizon.text);
      await this.emit(scope, conversationId, "assistant.sentence", { messageId, text: horizon.text });
    }
    if (failed) {
      const card = runs
        .filter(
          (r) => r.result && !(typeof r.result === "object" && r.result !== null && "error" in r.result),
        )
        .map((r) => ({ tool: r.tool, result: r.result }));
      return finish(
        {
          text: [...shown, SHOWING_DATA[lang]].join(" "),
          checked: false,
          fallback: true,
          numbersChecked: numbers,
          card,
        },
        runs,
      );
    }
    return finish(
      { text: shown.join(" ") || UNAVAILABLE[lang], checked: true, numbersChecked: numbers },
      runs,
    );
  }
}
