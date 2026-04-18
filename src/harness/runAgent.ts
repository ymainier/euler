import type { AgentEvent, HarnessConfig, ConfidenceScore, TokenUsage } from "../types.ts";

export type FinalOutput =
  | { kind: "done"; answer: string; confidence: ConfidenceScore; tokenUsage: TokenUsage; durationMs: number }
  | { kind: "escalated"; reasoning: string; partialAnswer?: string; confidence: ConfidenceScore; tokenUsage: TokenUsage; durationMs: number }
  | { kind: "error"; message: string };

// TODO: implement
export function runAgent(
  _goal: string,
  _config: HarnessConfig
): AsyncGenerator<AgentEvent, FinalOutput, void> {
  throw new Error("Not implemented");
}
