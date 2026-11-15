import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { ENV, type Env } from "../config/config.js";
import { currentWorkspaceId } from "./request-context.js";
import { assertWorkspaceScope, RELATION_SCOPED, scopeRelationArgs, WorkspaceScopeError } from "./workspace-scope.js";

const PARENT_FKS: Record<string, "field" | "recommendation" | "reportItem" | "conversation"> = {
  fieldId: "field",
  recommendationId: "recommendation",
  reportItemId: "reportItem",
  conversationId: "conversation",
};

/** Creating a child row under a parent (field, recommendation, …) of another workspace is rejected. */
async function assertParentsInWorkspace(
  base: PrismaClient,
  model: string | undefined,
  operation: string,
  args: unknown,
  ws: string,
): Promise<void> {
  if (!model || !RELATION_SCOPED[model] || !operation.startsWith("create")) return;
  const data = (args as { data?: unknown }).data;
  for (const row of Array.isArray(data) ? data : [data]) {
    if (!row || typeof row !== "object") continue;
    for (const [fk, parent] of Object.entries(PARENT_FKS)) {
      const id = (row as Record<string, unknown>)[fk];
      if (typeof id !== "string") continue;
      const delegate = base[parent] as unknown as { count(a: unknown): Promise<number> };
      if ((await delegate.count({ where: { id, workspaceId: ws } })) === 0)
        throw new WorkspaceScopeError(model, operation);
    }
  }
}

export function createScopedClient(base: PrismaClient) {
  return base.$extends({
    name: "workspace-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const ws = currentWorkspaceId();
          assertWorkspaceScope(model, operation, args, ws);
          if (ws) await assertParentsInWorkspace(base, model, operation, args, ws);
          return query(scopeRelationArgs(model, operation, args, ws) as typeof args);
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
