import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { CookieOptions, Request, Response } from "express";
import { z } from "zod";
import { ENV, type Env } from "../config/config.js";
import { ProblemException } from "../http/problem.js";
import { ZodPipe } from "../http/zod.js";
import { AuthService, type Session } from "./auth.service.js";
import { AuthGuard, type AuthedRequest } from "./current-user.js";
import { AUTH_BUCKET, FORGOT_BUCKET, MAIL_BUCKET, RateLimitService } from "./rate-limit.js";
import { ACCESS_COOKIE, hashToken, ACCESS_TTL_S, REFRESH_COOKIE, REFRESH_TTL_S } from "./tokens.js";

const Email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const SignupBody = z.object({
  email: Email,
  password: z.string().min(10, "at least 10 characters").max(200),
  name: z.string().trim().min(1).max(100),
  uiLanguage: z.enum(["uk", "en"]).default("en"),
});
const SetupBody = z.object({ password: z.string().min(10, "at least 10 characters").max(200) });
const ForgotBody = z.object({ email: Email });
const LoginBody = z.object({ email: Email, password: z.string().min(1).max(200) });

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly limits: RateLimitService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private cookie(maxAgeS: number, path: string): CookieOptions {
    return {
      httpOnly: true,
      secure: this.env.NODE_ENV === "production",
      sameSite: "lax",
      path,
      maxAge: maxAgeS * 1000,
    };
  }

  private setSession(res: Response, s: Session): void {
    res.cookie(ACCESS_COOKIE, s.access, this.cookie(ACCESS_TTL_S, "/"));
    res.cookie(REFRESH_COOKIE, s.refresh, this.cookie(REFRESH_TTL_S, "/api/auth"));
  }

  private clearSession(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, { path: "/" });
    res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
  }

  private async limit(req: Request, email: string): Promise<void> {
    const ip = req.ip ?? "unknown";
    const [a, b] = await Promise.all([
      this.limits.take(`auth:ip:${ip}`, AUTH_BUCKET),
      this.limits.take(`auth:email:${email}`, AUTH_BUCKET),
    ]);
    if (!a || !b) throw new ProblemException(429, "rate-limited", "Too many attempts; try again in a minute");
  }

  /**
   * Uniform answer for new and existing addresses (no account enumeration): 202, no session cookies. A new address
   * just gets its account (no verification step, PD v2.12); the web app then signs in with the same credentials via
   * /auth/login, which fails the same way for an existing address. An existing address is emailed "you already have
   * an account".
   */
  @Post("signup")
  @HttpCode(202)
  async signup(@Body(new ZodPipe(SignupBody)) body: z.infer<typeof SignupBody>, @Req() req: Request) {
    await this.limit(req, body.email);
    const mailOk = await this.limits.take(`mail:${body.email}`, MAIL_BUCKET);
    await this.auth.signup(body, mailOk);
    return { status: "ok" };
  }

  /** Uniform answer whether or not the address has an account. */
  @Post("forgot")
  @HttpCode(202)
  async forgot(@Body(new ZodPipe(ForgotBody)) body: z.infer<typeof ForgotBody>, @Req() req: Request) {
    await this.limits.enforce(`forgot:${req.ip ?? "unknown"}:${body.email}`, FORGOT_BUCKET);
    await this.limits.enforce(`forgot:ip:${req.ip ?? "unknown"}`, AUTH_BUCKET);
    const mailOk = await this.limits.take(`mail:${body.email}`, MAIL_BUCKET);
    await this.auth.forgotPassword(body.email, mailOk);
    return { status: "reset-sent" };
  }

  @Post("reset/:token")
  @HttpCode(204)
  async reset(
    @Param("token") token: string,
    @Body(new ZodPipe(SetupBody)) body: z.infer<typeof SetupBody>,
    @Req() req: Request,
  ): Promise<void> {
    await this.limit(req, `reset:${hashToken(token).slice(0, 16)}`);
    await this.auth.resetPassword(token, body.password);
  }

  @Get("setup/:token")
  async setupInfo(@Param("token") token: string, @Req() req: Request) {
    await this.limit(req, `setup:${hashToken(token).slice(0, 16)}`);
    return this.auth.setupInfo(token);
  }

  @Post("setup/:token")
  @HttpCode(200)
  async setup(
    @Param("token") token: string,
    @Body(new ZodPipe(SetupBody)) body: z.infer<typeof SetupBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.limit(req, `setup:${hashToken(token).slice(0, 16)}`);
    const s = await this.auth.completeSetup(token, body.password);
    this.setSession(res, s);
    return this.auth.me(s.userId);
  }

  @Post("login")
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(LoginBody)) body: z.infer<typeof LoginBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.limit(req, body.email);
    const s = await this.auth.login(body.email, body.password);
    this.setSession(res, s);
    return this.auth.me(s.userId);
  }

  @Post("refresh")
  @HttpCode(204)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
    try {
      this.setSession(res, await this.auth.rotate(token));
    } catch (e) {
      this.clearSession(res);
      throw e;
    }
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.refresh.revoke((req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE]);
    this.clearSession(res);
  }
}

@Controller("me")
@UseGuards(AuthGuard)
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  me(@Req() req: AuthedRequest) {
    return this.auth.me(req.user!.id);
  }
}
