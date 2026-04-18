import type { Snapshot } from "xstate";
import type { AgentContext } from "../types.ts";

export type CheckpointRecord = {
  runId: string;
  snapshot: Snapshot<unknown>;
  context: AgentContext;
  savedAt: string; // ISO
};

// TODO: implement
export class CheckpointStore {
  constructor(_dbPath: string) {}

  save(
    _runId: string,
    _snapshot: Snapshot<unknown>,
    _context: AgentContext,
  ): void {}

  load(_runId: string): CheckpointRecord | null {
    return null;
  }

  delete(_runId: string): void {}

  listRuns(): string[] {
    return [];
  }

  close(): void {}
}
