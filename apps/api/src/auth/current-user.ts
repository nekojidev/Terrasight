import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";

export interface AuthUser {
  id: string;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
  workspaceId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Resolves the signed-in user. EP-01 (S-01.01) replaces the body with JWT cookie verification.
 * Until then only the development stand-in works: with DEV_AUTH=true (never in production) the
 * `x-dev-user-id` header is trusted. Without it every request is unauthenticated.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const devUser = req.header("x-dev-user-id");
    if (this.env.DEV_AUTH && devUser && UUID.test(devUser)) {
      req.user = { id: devUser };
      return true;
    }
    throw new UnauthorizedException();
  }
}

/**
 * Checks that the user is a member of the workspace in the `:ws` route parameter.
 * Another workspace answers 404, not 403 (S-01.03). Role checks arrive with the permission matrix (S-01.03).
 */
@Injectable()
export class WorkspaceMemberGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const ws = req.params.ws;
    if (!req.user) throw new UnauthorizedException();
    if (typeof ws !== "string" || !UUID.test(ws)) throw new NotFoundException();
    const membership = await this.prisma.system.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: ws, userId: req.user.id } },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException();
    if (!membership.role) throw new ForbiddenException();
    req.workspaceId = ws;
    return true;
  }
}
