import { Global, Module } from "@nestjs/common";
import { AuthController, MeController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { AuthGuard, WorkspaceGuard } from "./current-user.js";
import { RateLimitService } from "./rate-limit.js";

@Global()
@Module({
  controllers: [AuthController, MeController],
  providers: [AuthService, RateLimitService, AuthGuard, WorkspaceGuard],
  exports: [AuthService, RateLimitService, AuthGuard, WorkspaceGuard],
})
export class AuthModule {}
