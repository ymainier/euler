import type { ModelMessage } from "ai";
import type { ReflectionOutput, TaskStatus, TokenUsage, RoleConfig } from "../types.ts";

// TODO: implement
export async function reflect(_args: {
  goal: string;
  tasks: Record<string, TaskStatus>;
  messages: ModelMessage[];
  config: RoleConfig;
  timeoutMs: number;
}): Promise<{ output: ReflectionOutput; usage: TokenUsage }> {
  throw new Error("Not implemented");
}
