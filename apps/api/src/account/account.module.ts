import { Body, Controller, HttpCode, Inject, Injectable, Module, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import argon2 from "argon2";
import type { Request, Response } from "express";
import { z } from "zod";
import { AuthGuard, type AuthedRequest } from "../auth/current-user.js";
import { ACCESS_COOKIE, hashToken, REFRESH_COOKIE } from "../auth/tokens.js";
import { PrismaService } from "../db/prisma.service.js";
import { ProblemException } from "../http/problem.js";
import { ZodPipe } from "../http/zod.js";

const ProfileBody = z
  .object({ name: z.string().trim().min(1).max(100), uiLanguage: z.enum(["uk", "en"]) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "nothing to change");
const PasswordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(10, "at least 10 characters").max(200),
});

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  async updateProfile(userId: string, input: z.infer<typeof ProfileBody>) {
    return this.prisma.system.user.update({
      where: { id: userId },
      data: input,
      select: { id: true, email: true, name: true, uiLanguage: true },
    });
  }

  /** Verifies the current password, sets the new one, revokes every refresh family except the caller's. */
  async changePassword(userId: string, current: string, next: string, keepRefresh: string | undefined) {
    const user = await this.prisma.system.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    const ok = user?.passwordHash ? await argon2.verify(user.passwordHash, current).catch(() => false) : false;
    if (!ok) throw new ProblemException(401, "bad-credentials", "Current password is wrong");
    await this.prisma.system.user.update({
      where: { id: userId },
      data: { passwordHash: await argon2.hash(next, { type: argon2.argon2id }) },
    });
    const keep = keepRefresh
      ? await this.prisma.system.refreshToken.findUnique({
          where: { tokenHash: hashToken(keepRefresh) },
          select: { familyId: true, userId: true },
        })
      : null;
    await this.prisma.system.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(keep && keep.userId === userId ? { familyId: { not: keep.familyId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAll(userId: string): Promise<void> {
    await this.prisma.system.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

@Controller("me")
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(private readonly account: AccountService) {}

  @Patch()
  update(@Body(new ZodPipe(ProfileBody)) body: z.infer<typeof ProfileBody>, @Req() req: AuthedRequest) {
    return this.account.updateProfile(req.user!.id, body);
  }
}

/** Under /auth so the browser sends the refresh cookie (its path is /api/auth). */
@Controller("auth")
@UseGuards(AuthGuard)
export class SessionsController {
  constructor(@Inject(AccountService) private readonly account: AccountService) {}

  @Post("password")
  @HttpCode(204)
  async password(
    @Body(new ZodPipe(PasswordBody)) body: z.infer<typeof PasswordBody>,
    @Req() req: AuthedRequest & Request,
  ): Promise<void> {
    const refresh = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
    await this.account.changePassword(req.user!.id, body.currentPassword, body.newPassword, refresh);
  }

  /** Sign out everywhere: every refresh token is revoked and this browser's cookies are cleared. */
  @Post("logout-all")
  @HttpCode(204)
  async logoutAll(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.account.revokeAll(req.user!.id);
    res.clearCookie(ACCESS_COOKIE, { path: "/" });
    res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
  }
}

@Module({ controllers: [ProfileController, SessionsController], providers: [AccountService] })
export class AccountModule {}
