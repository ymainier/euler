import type { Tool } from "ai";

export class ToolRegistry {
  private tools: Record<string, Tool>;

  constructor(tools: Record<string, Tool>) {
    this.tools = tools;
  }

  getSubset(names: string[]): Record<string, Tool> {
    const unknown = names.filter((n) => !(n in this.tools));
    if (unknown.length > 0) {
      throw new Error(`Unknown tools: ${unknown.join(", ")}`);
    }
    return Object.fromEntries(
      names.map((name) => [name, this.tools[name] as Tool]),
    );
  }

  list(): string[] {
    return Object.keys(this.tools);
  }
}
