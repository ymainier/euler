import { describe, expect, it } from "vitest";
import type { Snapshot } from "xstate";
import type { AgentContext } from "../types.ts";
import { CheckpointStore } from "./store.ts";

const makeContext = (runId: string): AgentContext => ({
  runId,
  taskGoal: "test goal",
  messages: [],
  toolResults: [],
  tasks: {},
  currentPlan: null,
  replanCount: 0,
  planValidationFeedback: null,
  totalTokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  startedAt: 0,
  checkpointAt: null,
  lastError: null,
});
const snapshot = { status: "active" } as unknown as Snapshot<unknown>;

describe("CheckpointStore", () => {
  it("save/load round-trip with in-memory SQLite", () => {
    const store = new CheckpointStore(":memory:");
    const ctx = makeContext("run-1");
    store.save("run-1", snapshot, ctx);
    const record = store.load("run-1");
    expect(record).not.toBeNull();
    expect(record!.runId).toBe("run-1");
    expect(record!.snapshot).toEqual(snapshot);
    expect(record!.context).toMatchObject(ctx);
    store.close();
  });

  it("load of missing runId returns null", () => {
    const store = new CheckpointStore(":memory:");
    expect(store.load("nonexistent")).toBeNull();
    store.close();
  });
  it("overwrite on re-save", () => {
    const store = new CheckpointStore(":memory:");
    store.save("run-1", snapshot, makeContext("run-1"));
    const ctx2 = { ...makeContext("run-1"), taskGoal: "updated goal" };
    store.save("run-1", snapshot, ctx2);
    const record = store.load("run-1");
    expect(record!.context.taskGoal).toBe("updated goal");
    store.close();
  });
  it("listRuns returns all saved run IDs", () => {
    const store = new CheckpointStore(":memory:");
    store.save("run-1", snapshot, makeContext("run-1"));
    store.save("run-2", snapshot, makeContext("run-2"));
    const runs = store.listRuns();
    expect(runs).toHaveLength(2);
    expect(runs).toEqual(expect.arrayContaining(["run-1", "run-2"]));
    store.close();
  });
  it("delete removes a run", () => {
    const store = new CheckpointStore(":memory:");
    store.save("run-1", snapshot, makeContext("run-1"));
    store.delete("run-1");
    expect(store.load("run-1")).toBeNull();
    expect(store.listRuns()).toEqual([]);
    store.close();
  });
  it("strips actorRef from running tasks at save time", () => {
    const store = new CheckpointStore(":memory:");
    const ctx = {
      ...makeContext("run-1"),
      tasks: {
        t1: {
          status: "running" as const,
          actorRef: {} as never,
          startedAt: 42,
        },
      },
    };
    store.save("run-1", snapshot, ctx);
    const record = store.load("run-1");
    const t1 = record!.context.tasks["t1"]!;
    expect(t1.status).toBe("running");
    expect((t1 as { startedAt: number }).startedAt).toBe(42);
    expect("actorRef" in t1).toBe(false);
    store.close();
  });
});
