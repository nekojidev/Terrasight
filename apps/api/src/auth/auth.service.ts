import { Inject, Injectable } from "@nestjs/common";
import argon2 from "argon2";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import type { Language } from "../generated/prisma/enums.js";
import { ProblemException } from "../http/problem.js";
import { RefreshTokens, type RefreshRow, type RefreshStore } from "./refresh.js";
import { signAccess } from "./tokens.js";

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
  ) {
    this.refresh = new RefreshTokens(new PrismaRefreshStore(prisma));
  }

  private async session(userId: string): Promise<Session> {
    return {
      userId,
      access: await signAccess(userId, this.env.JWT_SECRET),
      refresh: await this.refresh.issue(userId),
    };
  }

  async signup(input: {
    email: string;
    password: string;
    name: string;
    uiLanguage: Language;
  }): Promise<Session> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.system.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new ProblemException(409, "email-taken", "An account with this email already exists");
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const user = await this.prisma.system.user.create({
      data: { email, passwordHash, name: input.name.trim(), uiLanguage: input.uiLanguage },
      select: { id: true },
    });
    return this.session(user.id);
  }

  async login(emailRaw: string, password: string): Promise<Session> {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.prisma.system.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true },
    });
    const ok = await argon2.verify(user?.passwordHash ?? (await getDummyHash()), password).catch(() => false);
    if (!user || !ok) throw new ProblemException(401, "bad-credentials", "Email or password is wrong");
    return this.session(user.id);
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
