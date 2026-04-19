import type { ModelMessage } from "ai";
import { createActor } from "xstate";
import type {
  AgentEvent,
  HarnessConfig,
  PlannedTask,
  TaskStatus,
  ConfidenceScore,
} from "../types.ts";
import type { FinalOutput } from "../harness/runAgent.ts";
import { agentMachine } from "../machine/agentMachine.ts";
import { plan } from "../llm/planner.ts";
import { executeTask } from "../llm/executor.ts";
import { reflect } from "../llm/reflector.ts";
import { CheckpointStore } from "../checkpoint/store.ts";

export async function* resumeAgent(
  runId: string,
  config: HarnessConfig,
): AsyncGenerator<AgentEvent, FinalOutput, void> {
  const store = new CheckpointStore(config.db.path);
  const record = store.load(runId);
  if (!record) {
    throw new Error(`No checkpoint found for runId: ${runId}`);
  }

  const startedAt = record.context.startedAt;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawSnap = record.snapshot as any;

  const freshPlanFn = (g: string, feedback: string | null) =>
    plan({
      goal: g,
      messages: [],
      feedback,
      config: config.roles.planner,
      availableTools: Object.entries(config.tools).map(([name, tool]) => ({
        name,
        description: tool.description ?? "",
      })),
      timeoutMs: config.taskTimeoutMs,
    });
  const freshExecuteTaskFn = (task: PlannedTask) => {
    const knownNames = task.tools.filter((t) => t in config.tools);
    const tools =
      knownNames.length > 0
        ? Object.fromEntries(knownNames.map((t) => [t, config.tools[t]!]))
        : {};
    return executeTask({
      task,
      tools,
      config: config.roles.executor,
      maxSteps: config.maxTaskSteps,
      timeoutMs: config.taskTimeoutMs,
    });
  };
  const freshReflectFn = (
    g: string,
    tasks: Record<string, TaskStatus>,
    messages: ModelMessage[],
  ) =>
    reflect({
      goal: g,
      tasks,
      messages,
      config: config.roles.reflector,
      timeoutMs: config.taskTimeoutMs,
    });

  // Pre-execute any tasks that were `running` when the checkpoint was saved.
  // Their actorRef was stripped during serialization, so we re-run them from scratch.
  const snapshotTasks = (rawSnap.context.tasks ?? {}) as Record<
    string,
    TaskStatus
  >;
  const runningTaskIds = new Set(
    Object.entries(snapshotTasks)
      .filter(([, s]) => s.status === "running")
      .map(([id]) => id),
  );

  const updatedTasks: Record<string, TaskStatus> = { ...snapshotTasks };
  for (const taskId of runningTaskIds) {
    const taskDef = (
      (rawSnap.context.currentPlan?.tasks ?? []) as PlannedTask[]
    ).find((t) => t.taskId === taskId);
    if (taskDef) {
      try {
        const result = await freshExecuteTaskFn(taskDef);
        updatedTasks[taskId] = {
          status: "done",
          output: result.output,
          durationMs: 0,
          tokenUsage: result.usage,
        };
      } catch (err) {
        updatedTasks[taskId] = {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          retryCount: 0,
          durationMs: 0,
        };
      }
    } else {
      updatedTasks[taskId] = {
        status: "skipped",
        reason: "task definition not found after resume",
      };
    }
  }

  type ChildEntry = {
    snapshot: { status: string; input: Record<string, unknown> };
    src: string;
    syncSnapshot: boolean;
  };

  // Patch children: re-inject functions lost during JSON serialization,
  // and update the reflector's input to use the post-re-execution task map.
  const patchedChildren = Object.fromEntries(
    (Object.entries(rawSnap.children ?? {}) as Array<[string, ChildEntry]>).map(
      ([key, child]) => {
        if (child.src === "reflector") {
          return [
            key,
            {
              ...child,
              snapshot: {
                ...child.snapshot,
                input: {
                  ...child.snapshot.input,
                  tasks: updatedTasks,
                  reflectFn: freshReflectFn,
                },
              },
            },
          ];
        }
        if (child.src === "planner") {
          return [
            key,
            {
              ...child,
              snapshot: {
                ...child.snapshot,
                input: { ...child.snapshot.input, planFn: freshPlanFn },
              },
            },
          ];
        }
        if (child.src === "executor") {
          return [
            key,
            {
              ...child,
              snapshot: {
                ...child.snapshot,
                input: {
                  ...child.snapshot.input,
                  executeTaskFn: freshExecuteTaskFn,
                },
              },
            },
          ];
        }
        return [key, child];
      },
    ),
  );

  const patchedSnapshot = {
    ...rawSnap,
    context: {
      ...rawSnap.context,
      tasks: updatedTasks,
      planFn: freshPlanFn,
      executeTaskFn: freshExecuteTaskFn,
      reflectFn: freshReflectFn,
    },
    children: patchedChildren,
  };

  const queue: AgentEvent[] = [];
  let notify: (() => void) | null = null;
  let isDone = false;

  function enqueue(event: AgentEvent) {
    queue.push(event);
    notify?.();
    notify = null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actor = createActor(agentMachine, { snapshot: patchedSnapshot } as any);

  // prevTaskIds: only tasks that were already settled before resume (not the running ones)
  let prevTaskIds = new Set<string>(
    Object.keys(snapshotTasks).filter((id) => !runningTaskIds.has(id)),
  );

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
