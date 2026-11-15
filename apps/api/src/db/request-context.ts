import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The workspace of the current `/w/:ws` request, set by WorkspaceGuard after the membership check. The scoped
 * Prisma client (`PrismaService.db`) reads it to verify/inject the caller's workspace on every query.
 * Background jobs run outside a request, so it is undefined there.
 */
const store = new AsyncLocalStorage<{ workspaceId: string }>();

export function enterWorkspace(workspaceId: string): void {
  store.enterWith({ workspaceId });
}

export function runInWorkspace<T>(workspaceId: string, fn: () => T): T {
  return store.run({ workspaceId }, fn);
}

export function currentWorkspaceId(): string | undefined {
  return store.getStore()?.workspaceId;
}
