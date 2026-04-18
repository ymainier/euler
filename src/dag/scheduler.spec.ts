import { describe, expect, it } from "vitest";
import type { TaskStatus } from "../types.ts";
import { getReadyTasks } from "./scheduler.ts";

const basePlan = {
  reasoning: "test",
  canParallelize: true,
  maxConcurrency: 10,
};

const doneStatus = {
  status: "done" as const,
  output: { taskId: "x", result: "ok", toolsUsed: [] },
  durationMs: 1,
  tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
};

describe("getReadyTasks", () => {
  it("returns nothing when all deps are pending", () => {
    const plan = {
      ...basePlan,
      tasks: [{ taskId: "b", description: "B", tools: [], dependsOn: ["a"] }],
    };
    // "a" is not in tasks yet (pending)
    const result = getReadyTasks({}, plan, 10);
    expect(result).toEqual([]);
  });

  it("returns all tasks when none have dependencies", () => {
    const plan = {
      ...basePlan,
      tasks: [
        { taskId: "a", description: "A", tools: [], dependsOn: [] },
        { taskId: "b", description: "B", tools: [], dependsOn: [] },
      ],
    };
    const result = getReadyTasks({}, plan, 10);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.taskId)).toEqual(
      expect.arrayContaining(["a", "b"]),
    );
  });

  it("returns only tasks whose deps are done", () => {
    const plan = {
      ...basePlan,
      tasks: [
        { taskId: "a", description: "A", tools: [], dependsOn: [] },
        { taskId: "b", description: "B", tools: [], dependsOn: ["a"] },
        { taskId: "c", description: "C", tools: [], dependsOn: ["b"] },
      ],
    };
    // "a" is done, "b" is not yet in tasks
    const tasks = {
      a: { ...doneStatus, output: { ...doneStatus.output, taskId: "a" } },
    };
    const result = getReadyTasks(tasks, plan, 10);
    expect(result.map((t) => t.taskId)).toEqual(["b"]);
  });

  it("respects the concurrency cap", () => {
    const plan = {
      ...basePlan,
      maxConcurrency: 10,
      tasks: [
        { taskId: "a", description: "A", tools: [], dependsOn: [] },
        { taskId: "b", description: "B", tools: [], dependsOn: [] },
      ],
    };
    // one task already running, cap=1 → no slots left
    const tasks: Record<string, TaskStatus> = {
      x: { status: "running", actorRef: {} as never, startedAt: 0 },
    };
    const result = getReadyTasks(tasks, plan, 1);
    expect(result).toEqual([]);
  });

  it("excludes already-spawned tasks", () => {
    const plan = {
      ...basePlan,
      tasks: [{ taskId: "a", description: "A", tools: [], dependsOn: [] }],
    };
    const tasks = {
      a: { ...doneStatus, output: { ...doneStatus.output, taskId: "a" } },
    };
    const result = getReadyTasks(tasks, plan, 10);
    expect(result).toEqual([]);
  });

  it("excludes tasks with failed dependencies", () => {
    const plan = {
      ...basePlan,
      tasks: [{ taskId: "b", description: "B", tools: [], dependsOn: ["a"] }],
    };
    const tasks: Record<string, TaskStatus> = {
      a: { status: "failed", error: "oops", retryCount: 0, durationMs: 1 },
    };
    expect(getReadyTasks(tasks, plan, 10)).toEqual([]);
  });

  it("excludes tasks with skipped dependencies", () => {
    const plan = {
      ...basePlan,
      tasks: [{ taskId: "b", description: "B", tools: [], dependsOn: ["a"] }],
    };
    const tasks: Record<string, TaskStatus> = {
      a: { status: "skipped", reason: "dep failed" },
    };
    expect(getReadyTasks(tasks, plan, 10)).toEqual([]);
  });
});
