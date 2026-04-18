import type { AgentEvent, HarnessConfig } from "../types.ts";
import type { FinalOutput } from "../harness/runAgent.ts";

// TODO: implement
export function resumeAgent(
  _runId: string,
  _config: HarnessConfig
): AsyncGenerator<AgentEvent, FinalOutput, void> {
  throw new Error("Not implemented");
}
