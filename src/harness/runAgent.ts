import { createActor } from "xstate";
import type {
  AgentEvent,
  HarnessConfig,
  ConfidenceScore,
  TokenUsage,
} from "../types.ts";
import { agentMachine } from "../machine/agentMachine.ts";
import { plan } from "../llm/planner.ts";
import { executeTask } from "../llm/executor.ts";
import { reflect } from "../llm/reflector.ts";
import { CheckpointStore } from "../checkpoint/store.ts";

export type FinalOutput =
  | {
      kind: "done";
      answer: string;
      confidence: ConfidenceScore;
      tokenUsage: TokenUsage;
      durationMs: number;
    }
  | {
      kind: "escalated";
      reasoning: string;
      partialAnswer?: string;
      confidence: ConfidenceScore;
      tokenUsage: TokenUsage;
      durationMs: number;
    }
  | { kind: "error"; message: string };

export async function* runAgent(
  goal: string,
  config: HarnessConfig,
): AsyncGenerator<AgentEvent, FinalOutput, void> {
  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  const store = new CheckpointStore(config.db.path);

  const queue: AgentEvent[] = [];
  let notify: (() => void) | null = null;
  let isDone = false;

  function enqueue(event: AgentEvent) {
    queue.push(event);
    notify?.();
    notify = null;
  }

  const actor = createActor(agentMachine, {
    input: {
      goal,
      runId,
      planFn: (g, feedback) =>
        plan({
          goal: g,
          messages: [],
          feedback,
          config: config.roles.planner,
          timeoutMs: config.taskTimeoutMs,
        }),
      executeTaskFn: (task) =>
        executeTask({
          task,
          tools: config.tools,
          config: config.roles.executor,
          maxSteps: config.maxTaskSteps,
          timeoutMs: config.taskTimeoutMs,
        }),
      reflectFn: (g, tasks, messages) =>
        reflect({
          goal: g,
          tasks,
          messages,
          config: config.roles.reflector,
          timeoutMs: config.taskTimeoutMs,
        }),
      maxReplanCount: config.maxReplanCount,
      maxConcurrentTasks: config.maxConcurrentTasks,
      maxTaskRetries: config.maxTaskRetries,
    },
  });

  let prevTaskIds = new Set<string>();

  actor.subscribe((snapshot) => {
    const state = snapshot.value as string;
    const ctx = snapshot.context;

    if (state === "planning") {
      enqueue({ type: "planning", replanCount: ctx.replanCount });
    }

    if (state === "executing") {
      for (const task of ctx.currentPlan?.tasks ?? []) {
        if (!prevTaskIds.has(task.taskId)) {
          enqueue({
            type: "task_spawned",
            taskId: task.taskId,
            description: task.description,
          });
        }
      }
    }

    if (state === "reflecting") {
      const tasks = ctx.tasks;
      for (const [id, status] of Object.entries(tasks)) {
        if (!prevTaskIds.has(id)) {
          if (status.status === "done") {
            enqueue({
              type: "task_done",
              taskId: id,
              output: status.output,
              tokenUsage: status.tokenUsage,
              durationMs: status.durationMs,
            });
          } else if (status.status === "failed") {
            enqueue({
              type: "task_failed",
              taskId: id,
              error: status.error,
              retriesLeft: config.maxTaskRetries - status.retryCount,
              durationMs: status.durationMs,
            });
          } else if (status.status === "skipped") {
            enqueue({
              type: "task_skipped",
              taskId: id,
              reason: status.reason,
            });
          }
        }
      }
      prevTaskIds = new Set(Object.keys(tasks));

      const completedTasks = Object.values(tasks).filter(
        (t) => t.status === "done",
      ).length;
      const skippedTasks = Object.values(tasks).filter(
        (t) => t.status === "skipped",
      ).length;
      enqueue({ type: "reflecting", completedTasks, skippedTasks });

      const meta = snapshot.getMeta() as Record<
        string,
        { checkpoint?: boolean }
      >;
      const hasCheckpoint = Object.values(meta).some((m) => m?.checkpoint);
      if (hasCheckpoint) {
        store.save(runId, snapshot, {
          runId,
          taskGoal: goal,
          messages: ctx.messages,
          toolResults: [],
          tasks: ctx.tasks,
          currentPlan: ctx.currentPlan,
          replanCount: ctx.replanCount,
          planValidationFeedback: ctx.planFeedback,
          totalTokenUsage: ctx.totalTokenUsage,
          startedAt,
          checkpointAt: new Date().toISOString(),
          lastError: ctx.lastError,
        });
        enqueue({ type: "checkpoint", runId, at: new Date().toISOString() });
      }
    }

    if (snapshot.status === "done") {
      isDone = true;
      notify?.();
      notify = null;
    }
  });

  actor.start();

  while (!isDone || queue.length > 0) {
    while (queue.length > 0) {
      yield queue.shift()!;
    }
    if (!isDone) {
      await new Promise<void>((r) => {
        notify = r;
      });
    }
  }

  store.close();

  const snap = actor.getSnapshot();
  const machineOutput = snap.output!;
  const ctx = snap.context;
  const durationMs = Date.now() - startedAt;
  const tokenUsage = ctx.totalTokenUsage;

  if (machineOutput.decision === "done") {
    const confidence = (ctx.reflectionOutput as { confidence: ConfidenceScore })
      .confidence;
    return {
      kind: "done" as const,
      answer: machineOutput.answer,
      confidence,
      tokenUsage,
      durationMs,
    };
  }
  if (machineOutput.decision === "escalated") {
    const out = ctx.reflectionOutput as { confidence: ConfidenceScore } | null;
    return {
      kind: "escalated" as const,
      reasoning: machineOutput.reasoning,
      partialAnswer: machineOutput.partialAnswer,
      confidence: out?.confidence ?? { score: 0, reasoning: "unknown" },
      tokenUsage,
      durationMs,
    };
  }
  return { kind: "error" as const, message: machineOutput.error };
}
