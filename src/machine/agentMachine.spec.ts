import { describe, expect, it } from "vitest";
import { createActor, waitFor } from "xstate";
import type { TaskPlan, TaskStatus, TokenUsage } from "../types.ts";
import { agentMachine } from "./agentMachine.ts";

const zeroUsage: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

const makePlan = (overrides?: Partial<TaskPlan>): TaskPlan => ({
  reasoning: "step by step",
  tasks: [{ taskId: "t1", description: "do it", tools: [], dependsOn: [] }],
  canParallelize: false,
  maxConcurrency: 1,
  ...overrides,
});

const makeInput = (overrides?: object) => ({
  goal: "answer the question",
  runId: "run-1",
  planFn: async () => ({ plan: makePlan(), usage: zeroUsage }),
  executeTaskFn: async () => ({
    output: { taskId: "t1", result: "done", toolsUsed: [] },
    usage: zeroUsage,
  }),
  reflectFn: async () => ({
    output: {
      decision: "done" as const,
      answer: "42",
      reasoning: "because",
      confidence: { score: 0.9, reasoning: "strong" },
    },
    usage: zeroUsage,
  }),
  maxReplanCount: 3,
  maxConcurrentTasks: 4,
  maxTaskRetries: 2,
  ...overrides,
});

describe("agentMachine", () => {
  it("happy path: planning → executing → reflecting → done", async () => {
    const actor = createActor(agentMachine, { input: makeInput() }).start();
    const snapshot = await waitFor(actor, (s) => s.status === "done");
    expect(snapshot.output).toMatchObject({ decision: "done", answer: "42" });
  });

  it("cycle detected → replan with feedback → succeed", async () => {
    const cyclicPlan = makePlan({
      tasks: [
        { taskId: "t1", description: "a", tools: [], dependsOn: ["t2"] },
        { taskId: "t2", description: "b", tools: [], dependsOn: ["t1"] },
      ],
    });
    const validPlan = makePlan();
    let planCallCount = 0;
    let lastFeedback: string | null = null;

    const actor = createActor(agentMachine, {
      input: makeInput({
        planFn: async (_goal: string, feedback: string | null) => {
          lastFeedback = feedback;
          planCallCount++;
          return {
            plan: planCallCount === 1 ? cyclicPlan : validPlan,
            usage: zeroUsage,
          };
        },
      }),
    }).start();

    const snapshot = await waitFor(actor, (s) => s.status === "done");
    expect(snapshot.output).toMatchObject({ decision: "done", answer: "42" });
    expect(planCallCount).toBe(2);
    expect(lastFeedback).toMatch(/cycle/i);
  });

  it("task failure → dependents are skipped → reflector sees skipped tasks", async () => {
    const plan = makePlan({
      tasks: [
        { taskId: "t1", description: "root", tools: [], dependsOn: [] },
        { taskId: "t2", description: "child", tools: [], dependsOn: ["t1"] },
      ],
    });

    let reflectorTasks: Record<string, TaskStatus> | null = null;

    const actor = createActor(agentMachine, {
      input: makeInput({
        planFn: async () => ({ plan, usage: zeroUsage }),
        executeTaskFn: async (task: { taskId: string }) => {
          if (task.taskId === "t1") throw new Error("t1 failed");
          return {
            output: { taskId: task.taskId, result: "ok", toolsUsed: [] },
            usage: zeroUsage,
          };
        },
        reflectFn: async (_goal: string, tasks: Record<string, TaskStatus>) => {
          reflectorTasks = tasks;
          return {
            output: {
              decision: "done" as const,
              answer: "partial",
              reasoning: "best effort",
              confidence: { score: 0.5, reasoning: "partial" },
            },
            usage: zeroUsage,
          };
        },
      }),
    }).start();

    await waitFor(actor, (s) => s.status === "done");
    expect(reflectorTasks!["t1"]).toMatchObject({ status: "failed" });
    expect(reflectorTasks!["t2"]).toMatchObject({ status: "skipped" });
  });

  it("max replan exceeded → escalates after limit", async () => {
    let reflectCallCount = 0;

    const actor = createActor(agentMachine, {
      input: makeInput({
        maxReplanCount: 2,
        reflectFn: async () => {
          reflectCallCount++;
          return {
            output: {
              decision: "replan" as const,
              reasoning: "try again",
              feedback: "do better",
              skippedTasks: [],
              confidence: { score: 0.4, reasoning: "unsure" },
            },
            usage: zeroUsage,
          };
        },
      }),
    }).start();

    const snapshot = await waitFor(actor, (s) => s.status === "done");
    expect(snapshot.output).toMatchObject({ decision: "escalated" });
    // reflects once per plan execution; with maxReplanCount=2, runs 3 times (initial + 2 replans)
    expect(reflectCallCount).toBe(3);
  });

  it("plan invalid beyond retry limit → reaches failed state", async () => {
    const danglingPlan = makePlan({
      tasks: [
        { taskId: "t1", description: "bad", tools: [], dependsOn: ["missing"] },
      ],
    });

    const actor = createActor(agentMachine, {
      input: makeInput({
        maxReplanCount: 1,
        planFn: async () => ({ plan: danglingPlan, usage: zeroUsage }),
      }),
    }).start();

    const snapshot = await waitFor(actor, (s) => s.status === "done");
    expect(snapshot.output).toMatchObject({ decision: "failed" });
  });
});
