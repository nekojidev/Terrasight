import { describe, expect, it } from "vitest";
import { assertWorkspaceScope, WorkspaceScopeError } from "./workspace-scope.js";

const WS = "11111111-1111-4111-8111-111111111111";

describe("assertWorkspaceScope (Tech Design §5.2)", () => {
  it.each([
    ["findMany", { where: { workspaceId: WS } }],
    ["findFirst", { where: { id: "x", workspaceId: WS } }],
    ["update", { where: { id: "x", workspaceId: WS }, data: {} }],
    ["count", { where: { AND: [{ workspaceId: WS }, { status: "open" }] } }],
    ["findMany", { where: { workspaceId: { equals: WS } } }],
    ["create", { data: { workspaceId: WS, name: "Pivot 12" } }],
    ["create", { data: { workspace: { connect: { id: WS } } } }],
    ["createMany", { data: [{ workspaceId: WS }, { workspaceId: WS }] }],
  ])("allows Field.%s with a workspace filter", (op, args) => {
    expect(() => assertWorkspaceScope("Field", op, args)).not.toThrow();
  });

  it.each([
    ["findMany", {}],
    ["findMany", { where: { name: "Pivot 12" } }],
    ["findUnique", { where: { id: "x" } }],
    ["update", { where: { id: "x" }, data: {} }],
    ["deleteMany", { where: {} }],
    ["create", { data: { name: "Pivot 12" } }],
    ["createMany", { data: [{ workspaceId: WS }, { name: "no ws" }] }],
    ["upsert", { where: { id: "x", workspaceId: WS }, create: {}, update: {} }],
  ])("rejects Field.%s without one", (op, args) => {
    expect(() => assertWorkspaceScope("Field", op, args)).toThrow(WorkspaceScopeError);
  });

  it("ignores unscoped models", () => {
    expect(() => assertWorkspaceScope("User", "findUnique", { where: { id: "x" } })).not.toThrow();
    expect(() => assertWorkspaceScope("SourceCache", "findMany", {})).not.toThrow();
  });
});
