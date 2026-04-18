import type { Tool } from "ai";

// TODO: implement
export class ToolRegistry {
  constructor(_tools: Record<string, Tool>) {}

  getSubset(_names: string[]): Record<string, Tool> {
    return {};
  }

  list(): string[] {
    return [];
  }
}
