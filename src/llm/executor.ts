import type { Tool } from "ai";
import type { PlannedTask, TaskOutput, TokenUsage, RoleConfig } from "../types.ts";

// TODO: implement
export async function executeTask(_args: {
  task: PlannedTask;
  tools: Record<string, Tool>;
  config: RoleConfig;
  maxSteps: number;
  timeoutMs: number;
}): Promise<{ output: TaskOutput; usage: TokenUsage }> {
  throw new Error("Not implemented");
}
