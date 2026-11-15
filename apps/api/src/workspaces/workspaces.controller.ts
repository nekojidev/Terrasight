import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, Requires, WorkspaceGuard, type AuthedRequest, UUID } from "../auth/current-user.js";
import { ProblemException } from "../http/problem.js";
import { ZodPipe } from "../http/zod.js";
import { isTimeZone, WorkspacesService } from "./workspaces.service.js";

const WorkspaceBody = z.object({
  name: z.string().trim().min(1).max(80),
  timeZone: z.string().refine(isTimeZone, "unknown time zone"),
  units: z.enum(["metric", "imperial"]),
  reportLanguage: z.enum(["uk", "en"]),
});
const WorkspacePatch = WorkspaceBody.partial().refine((v) => Object.keys(v).length > 0, "nothing to change");
const InviteBody = z.object({
  // Design 02 says "Email or phone"; phone invites are not supported in v2.
  email: z.string().trim().toLowerCase().pipe(z.email("enter an email address").max(254)),
  role: z.enum(["owner", "admin", "agronomist", "viewer"]).default("viewer"),
});
const CreateUserBody = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().pipe(z.email("enter an email address").max(254)),
  role: z.enum(["owner", "admin", "agronomist", "viewer"]),
});
const RoleBody = z.object({ role: z.enum(["owner", "admin", "agronomist", "viewer"]) });

/** Routes without a workspace in the path. */
@Controller()
@UseGuards(AuthGuard)
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Post("workspaces")
  create(@Body(new ZodPipe(WorkspaceBody)) body: z.infer<typeof WorkspaceBody>, @Req() req: AuthedRequest) {
    return this.workspaces.create(req.user!.id, body);
  }

  @Post("invitations/:token/accept")
  @HttpCode(200)
  accept(@Param("token") token: string, @Req() req: AuthedRequest) {
    return this.workspaces.accept(token, req.user!.id);
  }
}

/** Public: what an invitation is for, shown before sign-in / sign-up. */
@Controller("invitations")
export class InvitationsPublicController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get(":token")
  info(@Param("token") token: string) {
    return this.workspaces.invitationInfo(token);
  }
}

@Controller("w/:ws")
@UseGuards(AuthGuard, WorkspaceGuard)
export class WorkspaceController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  @Requires("workspace.read")
  get(@Req() req: AuthedRequest) {
    return this.workspaces.get(req.workspaceId!).then((ws) => ({ ...ws, role: req.role }));
  }

  @Patch()
  @Requires("workspace.settings")
  update(@Body(new ZodPipe(WorkspacePatch)) body: z.infer<typeof WorkspacePatch>, @Req() req: AuthedRequest) {
    return this.workspaces.update(req.workspaceId!, req.user!.id, body);
  }

  @Get("members")
  @Requires("members.manage")
  members(@Req() req: AuthedRequest) {
    return this.workspaces.members(req.workspaceId!);
  }

  /** Owner creates users (PD v2.9): returns a one-time setup link, or adds an existing account. */
  @Post("members")
  @Requires("members.manage")
  createUser(
    @Body(new ZodPipe(CreateUserBody)) body: z.infer<typeof CreateUserBody>,
    @Req() req: AuthedRequest,
  ) {
    return this.workspaces.createUser(req.workspaceId!, { id: req.user!.id, role: req.role! }, body);
  }

  @Post("members/:userId/setup-link")
  @HttpCode(200)
  @Requires("members.manage")
  setupLink(@Param("userId") userId: string, @Req() req: AuthedRequest) {
    if (!UUID.test(userId)) throw new ProblemException(404, "not-found");
    return this.workspaces.newSetupLink(req.workspaceId!, { id: req.user!.id, role: req.role! }, userId);
  }

  @Post("invitations")
  @Requires("members.manage")
  invite(@Body(new ZodPipe(InviteBody)) body: z.infer<typeof InviteBody>, @Req() req: AuthedRequest) {
    return this.workspaces.invite(
      req.workspaceId!,
      { id: req.user!.id, role: req.role! },
      body.email,
      body.role,
    );
  }

  @Patch("members/:userId")
  @Requires("members.manage")
  setRole(
    @Param("userId") userId: string,
    @Body(new ZodPipe(RoleBody)) body: z.infer<typeof RoleBody>,
    @Req() req: AuthedRequest,
  ) {
    if (!UUID.test(userId)) throw new ProblemException(404, "not-found");
    return this.workspaces.setRole(
      req.workspaceId!,
      { id: req.user!.id, role: req.role! },
      userId,
      body.role,
    );
  }

  @Delete("members/:userId")
  @HttpCode(204)
  @Requires("members.manage")
  async remove(@Param("userId") userId: string, @Req() req: AuthedRequest): Promise<void> {
    if (!UUID.test(userId)) throw new ProblemException(404, "not-found");
    await this.workspaces.remove(req.workspaceId!, { id: req.user!.id, role: req.role! }, userId);
  }
}
