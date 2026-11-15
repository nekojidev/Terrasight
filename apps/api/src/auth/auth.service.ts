import { Inject, Injectable } from "@nestjs/common";
import argon2 from "argon2";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import type { Language } from "../generated/prisma/enums.js";
import { ProblemException } from "../http/problem.js";
import { RefreshTokens, type RefreshRow, type RefreshStore } from "./refresh.js";
import { Mailer } from "../mail/mailer.js";
import { templates } from "../mail/templates.js";
import { hashToken, newOpaqueToken, signAccess } from "./tokens.js";

export const RESET_TTL_H = 1;

export interface Session {
  userId: string;
  access: string;
  refresh: string;
}

class PrismaRefreshStore implements RefreshStore {
  constructor(private readonly prisma: PrismaService) {}

  async insert(row: Omit<RefreshRow, "revokedAt" | "replacedBy">): Promise<void> {
    await this.prisma.system.refreshToken.create({ data: row });
  }
  async findByHash(hash: string): Promise<RefreshRow | null> {
    return this.prisma.system.refreshToken.findUnique({ where: { tokenHash: hash } });
  }
  async markReplaced(oldId: string, newId: string, at: Date): Promise<boolean> {
    const r = await this.prisma.system.refreshToken.updateMany({
      where: { id: oldId, revokedAt: null, replacedBy: null },
      data: { revokedAt: at, replacedBy: newId },
    });
    return r.count === 1;
  }
  async findById(id: string): Promise<RefreshRow | null> {
    return this.prisma.system.refreshToken.findUnique({ where: { id } });
  }
  async revokeFamily(familyId: string, at: Date): Promise<void> {
    await this.prisma.system.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: at },
    });
  }
  async revoke(id: string, at: Date): Promise<void> {
    await this.prisma.system.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: at },
    });
  }
}

// A real hash to verify against when the email is unknown, so timing doesn't reveal which emails exist.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= argon2.hash(`dummy-${Math.random()}`, { type: argon2.argon2id }));

@Injectable()
export class AuthService {
  readonly refresh: RefreshTokens;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    private readonly mailer: Mailer,
  ) {
    this.refresh = new RefreshTokens(new PrismaRefreshStore(prisma));
  }

  private link(path: string, token?: string): string {
    return `${this.env.WEB_ORIGIN.replace(/\/$/, "")}${path}${token ? `/${token}` : ""}`;
  }

  private async session(userId: string): Promise<Session> {
    return {
      userId,
      access: await signAccess(userId, this.env.JWT_SECRET),
      refresh: await this.refresh.issue(userId),
    };
  }

  /**
   * Uniform sign-up: the caller always gets the same answer and no session, whether the address is new or already
   * registered (PD v2.12: no email verification). A new address just gets its account; an existing one gets a
   * "you already have an account" email. `sendMail=false` (throttled address) skips the email silently.
   */
  async signup(
    input: { email: string; password: string; name: string; uiLanguage: Language },
    sendMail = true,
  ): Promise<void> {
    const email = input.email.trim().toLowerCase();
    // Hash in both branches so response time doesn't reveal whether the account exists.
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const existing = await this.prisma.system.user.findUnique({
      where: { email },
      select: { uiLanguage: true },
    });
    let created = false;
    if (!existing) {
      try {
        await this.prisma.system.user.create({
          data: { email, passwordHash, name: input.name.trim(), uiLanguage: input.uiLanguage },
          select: { id: true },
        });
        created = true;
      } catch (e) {
        if ((e as { code?: string }).code !== "P2002") throw e; // lost a race with another sign-up: treat as existing
      }
    }
    if (created || !sendMail) return;
    const m = templates.alreadyRegistered(existing?.uiLanguage ?? input.uiLanguage, this.link("/login"));
    await this.mailer.trySend({ to: email, ...m });
  }

  /** Password reset request. Always resolves the same way; an email goes out only if the account exists. */
  async forgotPassword(emailRaw: string, sendMail = true): Promise<void> {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.prisma.system.user.findUnique({
      where: { email },
      select: { id: true, uiLanguage: true },
    });
    if (!user || !sendMail) return;
    const token = newOpaqueToken();
    await this.prisma.system.user.update({
      where: { id: user.id },
      data: { resetTokenHash: hashToken(token), resetExpiresAt: new Date(Date.now() + RESET_TTL_H * 36e5) },
    });
    await this.mailer.trySend({ to: email, ...templates.reset(user.uiLanguage, this.link("/reset", token)) });
  }

  /**
   * Sets a new password from a reset link (1 h, single use); every session of the user is revoked and a pending
   * setup link is dropped.
   */
  async resetPassword(token: string, password: string): Promise<void> {
    const tokenHash = hashToken(token);
    const user = await this.prisma.system.user.findUnique({
      where: { resetTokenHash: tokenHash },
      select: { id: true, resetExpiresAt: true },
    });
    const invalid = () =>
      new ProblemException(410, "reset-link-invalid", "This link has expired or was already used");
    if (!user?.resetExpiresAt || user.resetExpiresAt <= new Date()) throw invalid();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const now = new Date();
    await this.prisma.system.$transaction(async (tx) => {
      const claimed = await tx.user.updateMany({
        where: { id: user.id, resetTokenHash: tokenHash, resetExpiresAt: { gt: now } },
        data: {
          passwordHash,
          resetTokenHash: null,
          resetExpiresAt: null,
          setupTokenHash: null,
          setupExpiresAt: null,
        },
      });
      if (claimed.count !== 1) throw invalid();
      await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
    });
  }

  async login(emailRaw: string, password: string): Promise<Session> {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.prisma.system.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true },
    });
    // A user who hasn't set a password yet fails like a wrong password (no hint that the account exists).
    const ok = await argon2.verify(user?.passwordHash ?? (await getDummyHash()), password).catch(() => false);
    if (!user?.passwordHash || !ok)
      throw new ProblemException(401, "bad-credentials", "Email or password is wrong");
    return this.session(user.id);
  }

  /** The one-time "set your password" link (PD v2.9): sets the password, consumes the token, signs the user in. */
  async completeSetup(token: string, password: string): Promise<Session> {
    const tokenHash = hashToken(token);
    const user = await this.prisma.system.user.findUnique({
      where: { setupTokenHash: tokenHash },
      select: { id: true, setupExpiresAt: true },
    });
    if (!user || !user.setupExpiresAt || user.setupExpiresAt <= new Date())
      throw new ProblemException(410, "setup-link-invalid", "This link has expired or was already used");
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    // Claim atomically so two concurrent uses of one link can't both succeed.
    const claimed = await this.prisma.system.user.updateMany({
      where: { id: user.id, setupTokenHash: tokenHash, setupExpiresAt: { gt: new Date() } },
      data: { passwordHash, setupTokenHash: null, setupExpiresAt: null },
    });
    if (claimed.count !== 1)
      throw new ProblemException(410, "setup-link-invalid", "This link has expired or was already used");
    const memberships = await this.prisma.system.membership.findMany({
      where: { userId: user.id },
      select: { workspaceId: true },
    });
    await this.prisma.system.auditLog.createMany({
      data: memberships.map((m) => ({ workspaceId: m.workspaceId, userId: user.id, action: "user.setup" })),
    });
    return this.session(user.id);
  }

  /** What a setup link is for, shown on the page before the password is chosen (no account details leak beyond the name). */
  async setupInfo(token: string) {
    const user = await this.prisma.system.user.findUnique({
      where: { setupTokenHash: hashToken(token) },
      select: { name: true, email: true, setupExpiresAt: true },
    });
    if (!user || !user.setupExpiresAt || user.setupExpiresAt <= new Date())
      throw new ProblemException(410, "setup-link-invalid", "This link has expired or was already used");
    return { name: user.name, email: user.email };
  }

  async rotate(refreshToken: string | undefined): Promise<Session> {
    const r = await this.refresh.rotate(refreshToken);
    if (!r.ok) throw new ProblemException(401, `refresh-${r.reason}`);
    return { userId: r.userId, access: await signAccess(r.userId, this.env.JWT_SECRET), refresh: r.token };
  }

  async me(userId: string) {
    const user = await this.prisma.system.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        uiLanguage: true,
        memberships: {
          select: {
            role: true,
            workspace: {
              select: {
                id: true,
                name: true,
                slug: true,
                timeZone: true,
                units: true,
                reportLanguage: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!user) throw new ProblemException(401, "unknown-user");
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      uiLanguage: user.uiLanguage,
      workspaces: user.memberships.map((m) => ({ ...m.workspace, role: m.role })),
    };
  }
}
