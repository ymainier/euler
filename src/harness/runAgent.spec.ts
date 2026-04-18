import { describe, expect, it, vi, beforeEach } from "vitest";
import type { LanguageModel } from "ai";
import type { AgentEvent, HarnessConfig, TokenUsage } from "../types.ts";
import type { FinalOutput } from "./runAgent.ts";
import { runAgent } from "./runAgent.ts";
import { plan } from "../llm/planner.ts";
import { executeTask } from "../llm/executor.ts";
import { reflect } from "../llm/reflector.ts";

vi.mock("../llm/planner.ts");
vi.mock("../llm/executor.ts");
vi.mock("../llm/reflector.ts");

const zeroUsage: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};
const mockModel = {} as LanguageModel;
const mockRole = { model: mockModel, systemPrompt: "test" };

function makeConfig(overrides?: Partial<HarnessConfig>): HarnessConfig {
  return {
    roles: { planner: mockRole, executor: mockRole, reflector: mockRole },
    maxConcurrentTasks: 4,
    maxReplanCount: 3,
    maxTaskRetries: 2,
    maxTaskSteps: 5,
    taskTimeoutMs: 1000,
    tools: {},
    db: { path: ":memory:" },
    ...overrides,
  };
}

async function collect(
  gen: AsyncGenerator<AgentEvent, FinalOutput, void>,
): Promise<{ events: AgentEvent[]; result: FinalOutput }> {
  const events: AgentEvent[] = [];
  while (true) {
    const next = await gen.next();
    if (next.done) return { events, result: next.value };
    events.push(next.value);
  }
}

describe("runAgent", () => {
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

  it("happy path: returns { kind: 'done', answer: '42' }", async () => {
    const { result } = await collect(
      runAgent("answer the question", makeConfig()),
    );
    expect(result).toMatchObject({ kind: "done", answer: "42" });
  });

  it("emits planning event with replanCount: 0", async () => {
    const { events } = await collect(
      runAgent("answer the question", makeConfig()),
    );
    expect(events).toContainEqual({ type: "planning", replanCount: 0 });
  });

  it("emits task_spawned and task_done for executed task", async () => {
    const { events } = await collect(
      runAgent("answer the question", makeConfig()),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "task_spawned", taskId: "t1" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "task_done", taskId: "t1" }),
    );
  });

  it("emits reflecting event", async () => {
    const { events } = await collect(
      runAgent("answer the question", makeConfig()),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "reflecting" }),
    );
  });

  it("escalated path: returns { kind: 'escalated' }", async () => {
    vi.mocked(reflect).mockResolvedValue({
      output: {
        decision: "escalate" as const,
        answer: "",
        reasoning: "too hard",
        feedback: "",
        skippedTasks: [],
        partialAnswer: "",
        confidence: { score: 0.1, reasoning: "very low" },
      },
      usage: zeroUsage,
    });
    const { result } = await collect(
      runAgent("answer the question", makeConfig()),
    );
    expect(result).toMatchObject({ kind: "escalated", reasoning: "too hard" });
  });

  it("emits checkpoint event when reflecting state has meta.checkpoint", async () => {
    const { events } = await collect(
      runAgent("answer the question", makeConfig()),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "checkpoint",
        runId: expect.any(String),
      }),
    );
  });
});
