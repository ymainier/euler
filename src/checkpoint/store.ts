import { DatabaseSync } from "node:sqlite";
import type { Snapshot } from "xstate";
import type { AgentContext, TaskStatus } from "../types.ts";

export type CheckpointRecord = {
  runId: string;
  snapshot: Snapshot<unknown>;
  context: AgentContext;
  savedAt: string; // ISO
};

function stripActorRefs(
  tasks: AgentContext["tasks"],
): Record<
  string,
  | Omit<Extract<TaskStatus, { status: "running" }>, "actorRef">
  | Exclude<TaskStatus, { status: "running" }>
> {
  const result: Record<string, TaskStatus> = {};
  for (const [id, s] of Object.entries(tasks)) {
    if (s.status === "running") {
      result[id] = { status: "running", startedAt: s.startedAt } as TaskStatus;
    } else {
      result[id] = s;
    }
  }
  return result;
}

export class CheckpointStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        run_id TEXT PRIMARY KEY,
        snapshot_json TEXT NOT NULL,
        context_json TEXT NOT NULL,
        saved_at TEXT NOT NULL
      )
    `);
  }

  save(
    runId: string,
    snapshot: Snapshot<unknown>,
    context: AgentContext,
  ): void {
    const serialisableContext = {
      ...context,
      tasks: stripActorRefs(context.tasks),
    };
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO checkpoints (run_id, snapshot_json, context_json, saved_at)
       VALUES (?, ?, ?, ?)`,
    );
    stmt.run(
      runId,
      JSON.stringify(snapshot),
      JSON.stringify(serialisableContext),
      new Date().toISOString(),
    );
  }

  load(runId: string): CheckpointRecord | null {
    const stmt = this.db.prepare(
      `SELECT run_id, snapshot_json, context_json, saved_at FROM checkpoints WHERE run_id = ?`,
    );
    const row = stmt.get(runId) as
      | {
          run_id: string;
          snapshot_json: string;
          context_json: string;
          saved_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      runId: row.run_id,
      snapshot: JSON.parse(row.snapshot_json) as Snapshot<unknown>,
      context: JSON.parse(row.context_json) as AgentContext,
      savedAt: row.saved_at,
    };
  }

  delete(runId: string): void {
    this.db.prepare(`DELETE FROM checkpoints WHERE run_id = ?`).run(runId);
  }

  listRuns(): string[] {
    const rows = this.db.prepare(`SELECT run_id FROM checkpoints`).all() as {
      run_id: string;
    }[];
    return rows.map((r) => r.run_id);
  }

  close(): void {
    this.db.close();
  }
}
