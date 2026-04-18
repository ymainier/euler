import type { ModelMessage } from "ai";
import type { TaskPlan, TokenUsage, RoleConfig } from "../types.ts";

// TODO: implement
export async function plan(_args: {
  goal: string;
  messages: ModelMessage[];
  feedback: string | null;
  config: RoleConfig;
  timeoutMs: number;
}): Promise<{ plan: TaskPlan; usage: TokenUsage }> {
  throw new Error("Not implemented");
}
