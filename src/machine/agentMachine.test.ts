import { describe, expect, it, vi, beforeEach } from "vitest";
import { createActor, waitFor } from "xstate";
import type { LanguageModel, ModelMessage } from "ai";
import { agentMachine } from "./agentMachine.ts";
import { plan } from "../llm/planner.ts";
import { executeTask } from "../llm/executor.ts";
import { reflect } from "../llm/reflector.ts";
import type {
  PlannedTask,
  RoleConfig,
  TaskStatus,
  TokenUsage,
} from "../types.ts";

vi.mock("../llm/planner.ts");
vi.mock("../llm/executor.ts");
vi.mock("../llm/reflector.ts");

const zeroUsage: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};
const roleConfig: RoleConfig = {
  model: {} as LanguageModel,
  systemPrompt: "test",
};

function makeInput(overrides?: object) {
  return {
    goal: "answer the question",
    runId: "run-1",
    planFn: (goal: string, feedback: string | null) =>
      plan({
        goal,
        messages: [],
        feedback,
        config: roleConfig,
        availableTools: [],
        timeoutMs: 1000,
      }),
    executeTaskFn: (task: PlannedTask) =>
      executeTask({
        task,
        tools: {},
        config: roleConfig,
        maxSteps: 5,
        timeoutMs: 1000,
      }),
    reflectFn: (
      goal: string,
      tasks: Record<string, TaskStatus>,
      messages: ModelMessage[],
    ) =>
      reflect({ goal, tasks, messages, config: roleConfig, timeoutMs: 1000 }),
    maxReplanCount: 3,
    maxConcurrentTasks: 4,
    maxTaskRetries: 2,
    ...overrides,
  };
}

describe("agentMachine (integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(plan).mockResolvedValue({
      plan: {
        reasoning: "step by step",
        tasks: [
          { taskId: "t1", description: "do it", tools: [], dependsOn: [] },
        ],
        canParallelize: false,
        maxConcurrency: 1,
      },
      usage: zeroUsage,
    });
    vi.mocked(executeTask).mockResolvedValue({
      output: { taskId: "t1", result: "done", toolsUsed: [] },
      usage: zeroUsage,
    });
    vi.mocked(reflect).mockResolvedValue({
      output: {
        decision: "done" as const,
        answer: "42",
        reasoning: "because",
        feedback: "",
        skippedTasks: [],
        partialAnswer: "",
        confidence: { score: 0.9, reasoning: "strong" },
      },
      usage: zeroUsage,
    });
  });

  it("happy path: plan → execute → reflect → done", async () => {
    const actor = createActor(agentMachine, { input: makeInput() }).start();
    const snapshot = await waitFor(actor, (s) => s.status === "done");
    expect(snapshot.output).toMatchObject({ decision: "done", answer: "42" });
  });

  it("cycle detected → replan with feedback → succeed", async () => {
    const cyclicPlan = {
      reasoning: "oops",
      tasks: [
        { taskId: "t1", description: "a", tools: [], dependsOn: ["t2"] },
        { taskId: "t2", description: "b", tools: [], dependsOn: ["t1"] },
      ],
      canParallelize: false,
      maxConcurrency: 1,
    };
    const validPlan = {
      reasoning: "fixed",
      tasks: [{ taskId: "t1", description: "do it", tools: [], dependsOn: [] }],
      canParallelize: false,
      maxConcurrency: 1,
    };

    vi.mocked(plan)
      .mockResolvedValueOnce({ plan: cyclicPlan, usage: zeroUsage })
      .mockResolvedValueOnce({ plan: validPlan, usage: zeroUsage });

    const actor = createActor(agentMachine, { input: makeInput() }).start();
    const snapshot = await waitFor(actor, (s) => s.status === "done");

    expect(snapshot.output).toMatchObject({ decision: "done", answer: "42" });
    expect(vi.mocked(plan)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(plan).mock.calls[1]![0].feedback).toMatch(/cycle/i);
  });

  it("task failure → dependents skipped → reflector sees skip list", async () => {
    vi.mocked(plan).mockResolvedValue({
      plan: {
        reasoning: "two tasks",
        tasks: [
          { taskId: "t1", description: "root", tools: [], dependsOn: [] },
          {
            taskId: "t2",
            description: "child",
            tools: ["t1"],
            dependsOn: ["t1"],
          },
        ],
        canParallelize: false,
        maxConcurrency: 1,
      },
      usage: zeroUsage,
    });
    vi.mocked(executeTask).mockRejectedValue(new Error("t1 failed"));

    let capturedTasks: Record<string, TaskStatus> | null = null;
    vi.mocked(reflect).mockImplementation(async (args) => {
      capturedTasks = args.tasks;
      return {
        output: {
          decision: "done" as const,
          answer: "partial",
          reasoning: "best effort",
          feedback: "",
          skippedTasks: [],
          partialAnswer: "",
          confidence: { score: 0.5, reasoning: "partial" },
        },
        usage: zeroUsage,
      };
    });

    const actor = createActor(agentMachine, { input: makeInput() }).start();
    await waitFor(actor, (s) => s.status === "done");

    expect(capturedTasks!["t1"]).toMatchObject({ status: "failed" });
    expect(capturedTasks!["t2"]).toMatchObject({ status: "skipped" });
  });

  it("max replan exceeded → escalates after limit", async () => {
    vi.mocked(reflect).mockResolvedValue({
      output: {
        decision: "replan" as const,
        answer: "",
        reasoning: "try again",
        feedback: "do better",
        skippedTasks: [],
        partialAnswer: "",
        confidence: { score: 0.4, reasoning: "unsure" },
      },
      usage: zeroUsage,
    });

    const actor = createActor(agentMachine, {
      input: makeInput({ maxReplanCount: 2 }),
    }).start();
    const snapshot = await waitFor(actor, (s) => s.status === "done");

    expect(snapshot.output).toMatchObject({ decision: "escalated" });
    // initial + 2 replans = 3 reflect calls
    expect(vi.mocked(reflect)).toHaveBeenCalledTimes(3);
  });

  it("plan invalid beyond retry limit → reaches failed state", async () => {
    vi.mocked(plan).mockResolvedValue({
      plan: {
        reasoning: "bad",
        tasks: [
          {
            taskId: "t1",
            description: "bad",
            tools: [],
            dependsOn: ["missing"],
          },
        ],
        canParallelize: false,
        maxConcurrency: 1,
      },
      usage: zeroUsage,
    });

    const actor = createActor(agentMachine, {
      input: makeInput({ maxReplanCount: 1 }),
    }).start();
    const snapshot = await waitFor(actor, (s) => s.status === "done");

    expect(snapshot.output).toMatchObject({ decision: "failed" });
  });
});
