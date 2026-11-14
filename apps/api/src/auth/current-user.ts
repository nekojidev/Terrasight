import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import type { Role } from "../generated/prisma/enums.js";
import { can, type Permission } from "./permissions.js";
import { ACCESS_COOKIE, verifyAccess } from "./tokens.js";

export interface AuthUser {
  id: string;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
  workspaceId?: string;
  role?: Role;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Verifies the access JWT from the httpOnly cookie (Tech Design §14.1). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
    const userId = await verifyAccess(cookies[ACCESS_COOKIE], this.env.JWT_SECRET);
    if (!userId) throw new UnauthorizedException();
    req.user = { id: userId };
    return true;
  }
}

export const PERMISSION_KEY = "terrasight:permission";
/** Declares the permission a workspace route needs (checked by WorkspaceGuard). */
export const Requires = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);

/**
 * Membership + permission check for `/w/:ws/...` routes (S-01.03). Another workspace answers 404, not 403;
 * a member without the permission gets 403.
 */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

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
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (permission && !can(membership.role, permission)) throw new ForbiddenException();
    req.workspaceId = ws;
    req.role = membership.role;
    return true;
  }
}
