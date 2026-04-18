import { describe, expect, it } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { ToolRegistry } from "./registry.ts";

const makeTool = () =>
  tool({
    description: "a tool",
    inputSchema: z.object({ q: z.string() }),
    execute: async () => "ok",
  });

describe("ToolRegistry", () => {
  it("list() returns names of all registered tools", () => {
    const registry = new ToolRegistry({
      search: makeTool(),
      fetch: makeTool(),
    });

    expect(registry.list()).toEqual(["search", "fetch"]);
  });

  it("getSubset() returns only the requested tools", () => {
    const searchTool = makeTool();
    const fetchTool = makeTool();
    const registry = new ToolRegistry({ search: searchTool, fetch: fetchTool });

    expect(registry.getSubset(["search"])).toEqual({ search: searchTool });
  });

  it("getSubset() throws on an unknown tool name", () => {
    const registry = new ToolRegistry({ search: makeTool() });

    expect(() => registry.getSubset(["unknown"])).toThrow("unknown");
  });
});
