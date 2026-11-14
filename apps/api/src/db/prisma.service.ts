import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { ENV, type Env } from "../config/config.js";
import { assertWorkspaceScope } from "./workspace-scope.js";

export function createScopedClient(base: PrismaClient) {
  return base.$extends({
    name: "workspace-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          assertWorkspaceScope(model, operation, args);
          return query(args);
        },
      },
    },
  });
}

export type ScopedPrisma = ReturnType<typeof createScopedClient>;

/**
 * Two clients over one connection pool:
 * - `db`: the default, workspace-scoped client (rejects unscoped queries on scoped tables);
 * - `system`: unscoped, only for cross-workspace system jobs (scheduler, retention, outbox relay).
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly system: PrismaClient;
  readonly db: ScopedPrisma;

  constructor(@Inject(ENV) env: Env) {
    this.system = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
    this.db = createScopedClient(this.system);
  }

  async ping(): Promise<boolean> {
    try {
      await this.system.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.system.$disconnect();
  }
}
