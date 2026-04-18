import { setup, fromPromise, assign } from "xstate";
import type { ModelMessage } from "ai";
import type {
  TaskPlan,
  TaskStatus,
  TaskOutput,
  TokenUsage,
  ReflectionOutput,
  PlannedTask,
} from "../types.ts";
import { validatePlan } from "../dag/validator.ts";
import { getReadyTasks } from "../dag/scheduler.ts";

export type AgentMachineInput = {
  goal: string;
  runId: string;
  planFn: (
    goal: string,
    feedback: string | null,
  ) => Promise<{ plan: TaskPlan; usage: TokenUsage }>;
  reflectFn: (
    goal: string,
    tasks: Record<string, TaskStatus>,
    messages: ModelMessage[],
  ) => Promise<{ output: ReflectionOutput; usage: TokenUsage }>;
  executeTaskFn: (
    task: PlannedTask,
  ) => Promise<{ output: TaskOutput; usage: TokenUsage }>;
  maxReplanCount: number;
  maxConcurrentTasks: number;
  maxTaskRetries: number;
};

type AgentMachineContext = AgentMachineInput & {
  currentPlan: TaskPlan | null;
  tasks: Record<string, TaskStatus>;
  replanCount: number;
  planFeedback: string | null;
  reflectionOutput: ReflectionOutput | null;
  totalTokenUsage: TokenUsage;
  lastError: string | null;
  messages: ModelMessage[];
  outcome: "done" | "escalated" | "failed" | null;
};

type AgentMachineOutput =
  | { decision: "done"; answer: string }
  | { decision: "escalated"; reasoning: string; partialAnswer?: string }
  | { decision: "failed"; error: string };

function markDependentsSkipped(
  tasks: Record<string, TaskStatus>,
  failedTaskId: string,
  plan: TaskPlan,
): void {
  for (const task of plan.tasks) {
    if (task.dependsOn.includes(failedTaskId) && !(task.taskId in tasks)) {
      tasks[task.taskId] = {
        status: "skipped",
        reason: `dependency ${failedTaskId} failed or was skipped`,
      };
      markDependentsSkipped(tasks, task.taskId, plan);
    }
  }
}

export const agentMachine = setup({
  types: {
    input: {} as AgentMachineInput,
    context: {} as AgentMachineContext,
    output: {} as AgentMachineOutput,
  },
  actors: {
    planner: fromPromise(
      async ({
        input,
      }: {
        input: {
          goal: string;
          feedback: string | null;
          planFn: AgentMachineInput["planFn"];
        };
      }) => input.planFn(input.goal, input.feedback),
    ),
    executor: fromPromise(
      async ({
        input,
      }: {
        input: {
          plan: TaskPlan;
          executeTaskFn: AgentMachineInput["executeTaskFn"];
          maxConcurrentTasks: number;
        };
      }) => {
        const { plan, executeTaskFn, maxConcurrentTasks } = input;
        const tasks: Record<string, TaskStatus> = {};

        while (true) {
          const ready = getReadyTasks(tasks, plan, maxConcurrentTasks);
          if (ready.length === 0) break;

          const results = await Promise.allSettled(
            ready.map((task) => executeTaskFn(task)),
          );

          ready.forEach((task, i) => {
            const result = results[i]!;
            if (result.status === "fulfilled") {
              tasks[task.taskId] = {
                status: "done",
                output: result.value.output,
                durationMs: 0,
                tokenUsage: result.value.usage,
              };
            } else {
              const err = result.reason;
              tasks[task.taskId] = {
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
                retryCount: 0,
                durationMs: 0,
              };
              markDependentsSkipped(tasks, task.taskId, plan);
            }
          });
        }

        return tasks;
      },
    ),
    reflector: fromPromise(
      async ({
        input,
      }: {
        input: {
          goal: string;
          tasks: Record<string, TaskStatus>;
          messages: ModelMessage[];
          reflectFn: AgentMachineInput["reflectFn"];
        };
      }) => input.reflectFn(input.goal, input.tasks, input.messages),
    ),
  },
}).createMachine({
  id: "agentMachine",
  initial: "planning",
  context: ({ input }) => ({
    ...input,
    currentPlan: null,
    tasks: {},
    replanCount: 0,
    planFeedback: null,
    reflectionOutput: null,
    totalTokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    lastError: null,
    messages: [],
    outcome: null,
  }),
  output: ({ context }) => {
    if (context.outcome === "done") {
      const out = context.reflectionOutput as ReflectionOutput;
      return { decision: "done", answer: out.answer };
    }
    if (context.outcome === "escalated") {
      const out = context.reflectionOutput;
      if (out?.decision === "escalate")
        return {
          decision: "escalated",
          reasoning: out.reasoning,
          partialAnswer: out.partialAnswer,
        };
      return { decision: "escalated", reasoning: "replan limit reached" };
    }
    return { decision: "failed", error: context.lastError ?? "unknown error" };
  },
  states: {
    planning: {
      invoke: {
        src: "planner",
        input: ({ context }) => ({
          goal: context.goal,
          feedback: context.planFeedback,
          planFn: context.planFn,
        }),
        onDone: [
          {
            guard: ({ event }) => validatePlan(event.output.plan) === null,
            target: "executing",
            actions: assign({
              currentPlan: ({ event }) => event.output.plan,
              tasks: () => ({}),
              planFeedback: () => null,
            }),
          },
          {
            guard: ({ context }) =>
              context.replanCount >= context.maxReplanCount,
            target: "failed",
            actions: assign({
              lastError: ({ event }) => validatePlan(event.output.plan),
              outcome: () => "failed" as const,
            }),
          },
          {
            target: "replanningFromInvalidPlan",
            actions: assign({
              planFeedback: ({ event }) => validatePlan(event.output.plan),
              replanCount: ({ context }) => context.replanCount + 1,
            }),
          },
        ],
        onError: {
          target: "failed",
          actions: assign({
            lastError: ({ event }) =>
              (event.error as Error)?.message ?? String(event.error),
            outcome: () => "failed" as const,
          }),
        },
      },
    },
    executing: {
      invoke: {
        src: "executor",
        input: ({ context }) => ({
          plan: context.currentPlan!,
          executeTaskFn: context.executeTaskFn,
          maxConcurrentTasks: context.maxConcurrentTasks,
        }),
        onDone: {
          target: "reflecting",
          actions: assign({ tasks: ({ event }) => event.output }),
        },
        onError: {
          target: "failed",
          actions: assign({
            lastError: ({ event }) =>
              (event.error as Error)?.message ?? String(event.error),
            outcome: () => "failed" as const,
          }),
        },
      },
    },
    reflecting: {
      meta: { checkpoint: true },
      invoke: {
        src: "reflector",
        input: ({ context }) => ({
          goal: context.goal,
          tasks: context.tasks,
          messages: context.messages,
          reflectFn: context.reflectFn,
        }),
        onDone: [
          {
            guard: ({ event }) => event.output.output.decision === "done",
            target: "done",
            actions: assign({
              reflectionOutput: ({ event }) => event.output.output,
              outcome: () => "done" as const,
            }),
          },
          {
            guard: ({ event, context }) =>
              event.output.output.decision === "replan" &&
              context.replanCount < context.maxReplanCount,
            target: "replanningFromReflector",
            actions: assign({
              reflectionOutput: ({ event }) => event.output.output,
              replanCount: ({ context }) => context.replanCount + 1,
              planFeedback: ({ event }) =>
                event.output.output.decision === "replan"
                  ? event.output.output.feedback
                  : null,
            }),
          },
          {
            target: "escalated",
            actions: assign({
              reflectionOutput: ({ event }) => event.output.output,
              outcome: () => "escalated" as const,
            }),
          },
        ],
        onError: {
          target: "failed",
          actions: assign({
            lastError: ({ event }) =>
              (event.error as Error)?.message ?? String(event.error),
            outcome: () => "failed" as const,
          }),
        },
      },
    },
    replanningFromInvalidPlan: { always: "planning" },
    replanningFromReflector: { always: "planning" },
    done: { type: "final" },
    escalated: { type: "final" },
    failed: { type: "final" },
  },
});
