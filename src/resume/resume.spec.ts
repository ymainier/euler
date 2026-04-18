import { describe, expect, it, vi, beforeEach } from "vitest";
import { createActor, waitFor } from "xstate";
import type { LanguageModel, ModelMessage } from "ai";
import type {
  AgentEvent,
  HarnessConfig,
  PlannedTask,
  TaskStatus,
  TokenUsage,
} from "../types.ts";
import type { FinalOutput } from "../harness/runAgent.ts";
import { resumeAgent } from "./resume.ts";
import { plan } from "../llm/planner.ts";
import { executeTask } from "../llm/executor.ts";
import { reflect } from "../llm/reflector.ts";
import { CheckpointStore } from "../checkpoint/store.ts";
import { agentMachine } from "../machine/agentMachine.ts";
import type { Snapshot } from "xstate";
import type { AgentContext } from "../types.ts";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("../llm/planner.ts");
vi.mock("../llm/executor.ts");
vi.mock("../llm/reflector.ts");

const zeroUsage: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};
const mockModel = {} as LanguageModel;
const roleConfig = { model: mockModel, systemPrompt: "test" };

function makeTempDbPath() {
  return join(tmpdir(), `euler-resume-test-${crypto.randomUUID()}.db`);
}

function makeConfig(overrides?: Partial<HarnessConfig>): HarnessConfig {
  return {
    roles: { planner: roleConfig, executor: roleConfig, reflector: roleConfig },
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

function makeInput() {
  return {
    goal: "answer the question",
    runId: "run-1",
    planFn: (g: string, feedback: string | null) =>
      plan({
        goal: g,
        messages: [],
        feedback,
        config: roleConfig,
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
      g: string,
      tasks: Record<string, TaskStatus>,
      messages: ModelMessage[],
    ) =>
      reflect({
        goal: g,
        tasks,
        messages,
        config: roleConfig,
        timeoutMs: 1000,
      }),
    maxReplanCount: 3,
    maxConcurrentTasks: 4,
    maxTaskRetries: 2,
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(plan).mockResolvedValue({
    plan: {
      reasoning: "step by step",
      tasks: [{ taskId: "t1", description: "do it", tools: [], dependsOn: [] }],
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
      confidence: { score: 0.9, reasoning: "strong" },
    },
    usage: zeroUsage,
  });
});

async function freezeAtReflecting(runId: string) {
  // Make reflect hang so actor stays in "reflecting" state
  vi.mocked(reflect).mockImplementation(() => new Promise(() => {}));

  const actor = createActor(agentMachine, {
    input: { ...makeInput(), runId },
  }).start();
  await waitFor(actor, (s) => s.value === "reflecting", { timeout: 2000 });
  const persistedSnap = actor.getPersistedSnapshot();
  actor.stop();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snapAny = persistedSnap as any;
  const context: AgentContext = {
    runId,
    taskGoal: "answer the question",
    messages: snapAny.context.messages ?? [],
    toolResults: [],
    tasks: snapAny.context.tasks ?? {},
    currentPlan: snapAny.context.currentPlan ?? null,
    replanCount: snapAny.context.replanCount ?? 0,
    planValidationFeedback: snapAny.context.planFeedback ?? null,
    totalTokenUsage: snapAny.context.totalTokenUsage ?? zeroUsage,
    startedAt: Date.now(),
    checkpointAt: new Date().toISOString(),
    lastError: snapAny.context.lastError ?? null,
  };

  return { persistedSnap: persistedSnap as Snapshot<unknown>, context };
}

describe("resumeAgent", () => {
  it("throws if checkpoint not found for runId", async () => {
    const gen = resumeAgent("unknown-id", makeConfig());
    await expect(gen.next()).rejects.toThrow(
      "No checkpoint found for runId: unknown-id",
    );
  });

  it("resumes from checkpoint and returns { kind: 'done' }", async () => {
    const dbPath = makeTempDbPath();
    const runId = "run-resume-1";

    const { persistedSnap, context } = await freezeAtReflecting(runId);

    // Save checkpoint
    const store = new CheckpointStore(dbPath);
    store.save(runId, persistedSnap, context);
    store.close();

    // Now let reflect resolve
    vi.mocked(reflect).mockResolvedValue({
      output: {
        decision: "done" as const,
        answer: "42",
        reasoning: "because",
        confidence: { score: 0.9, reasoning: "strong" },
      },
      usage: zeroUsage,
    });

    const { result } = await collect(
      resumeAgent(runId, makeConfig({ db: { path: dbPath } })),
    );
    expect(result).toMatchObject({ kind: "done", answer: "42" });
  });

  it("preserves pre-crash totalTokenUsage in the final output", async () => {
    const dbPath = makeTempDbPath();
    const runId = "run-resume-2";

    const { persistedSnap, context } = await freezeAtReflecting(runId);

    const precrashUsage: TokenUsage = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    };

    // Override totalTokenUsage in snapshot context and AgentContext to simulate pre-crash tokens
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const snapWithUsage = {
      ...(persistedSnap as any),
      context: {
        ...(persistedSnap as any).context,
        totalTokenUsage: precrashUsage,
      },
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const store = new CheckpointStore(dbPath);
    store.save(runId, snapWithUsage as Snapshot<unknown>, {
      ...context,
      totalTokenUsage: precrashUsage,
    });
    store.close();

    vi.mocked(reflect).mockResolvedValue({
      output: {
        decision: "done" as const,
        answer: "42",
        reasoning: "because",
        confidence: { score: 0.9, reasoning: "strong" },
      },
      usage: zeroUsage,
    });

    const { result } = await collect(
      resumeAgent(runId, makeConfig({ db: { path: dbPath } })),
    );
    expect(result).toMatchObject({
      kind: "done",
      tokenUsage: precrashUsage,
    });
  });

  it("re-spawns running tasks found in checkpoint (strips them for re-execution)", async () => {
    const dbPath = makeTempDbPath();
    const runId = "run-resume-3";

    const { persistedSnap, context } = await freezeAtReflecting(runId);

    // Inject a "running" task into the snapshot context (simulating mid-execution crash)
    // Also add t2 to currentPlan so resumeAgent can look it up and re-execute it.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const snap = persistedSnap as any;
    const snapWithRunning = {
      ...snap,
      context: {
        ...snap.context,
        currentPlan: {
          ...snap.context.currentPlan,
          tasks: [
            ...snap.context.currentPlan.tasks,
            {
              taskId: "t2",
              description: "re-run me",
              tools: [],
              dependsOn: [],
            },
          ],
        },
        tasks: {
          ...snap.context.tasks,
          t2: { status: "running", startedAt: Date.now() },
        },
      },
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const store = new CheckpointStore(dbPath);
    store.save(runId, snapWithRunning as Snapshot<unknown>, {
      ...context,
      tasks: {
        ...context.tasks,
        t2: { status: "running", startedAt: Date.now() } as TaskStatus,
      },
    });
    store.close();

    vi.mocked(plan).mockResolvedValue({
      plan: {
        reasoning: "step by step",
        tasks: [
          { taskId: "t1", description: "do it", tools: [], dependsOn: [] },
          { taskId: "t2", description: "re-run me", tools: [], dependsOn: [] },
        ],
        canParallelize: false,
        maxConcurrency: 1,
      },
      usage: zeroUsage,
    });
    vi.mocked(executeTask).mockResolvedValue({
      output: { taskId: "t2", result: "re-done", toolsUsed: [] },
      usage: zeroUsage,
    });
    vi.mocked(reflect).mockResolvedValue({
      output: {
        decision: "done" as const,
        answer: "42",
        reasoning: "because",
        confidence: { score: 0.9, reasoning: "strong" },
      },
      usage: zeroUsage,
    });

    const { events } = await collect(
      resumeAgent(runId, makeConfig({ db: { path: dbPath } })),
    );
    // t2 was "running" in checkpoint → should be re-spawned
    expect(events).toContainEqual(
      expect.objectContaining({ type: "task_done", taskId: "t2" }),
    );
  });
});
