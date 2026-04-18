import { setup, fromPromise, assign } from "xstate";
import type { PlannedTask, TaskOutput, TokenUsage } from "../types.ts";
import type { Tool } from "ai";

type TaskActorInput = {
  task: PlannedTask;
  tools: Record<string, Tool>;
  executeTask: (args: {
    task: PlannedTask;
    tools: Record<string, Tool>;
  }) => Promise<{ output: TaskOutput; usage: TokenUsage }>;
  maxTaskRetries: number;
};

type TaskActorContext = TaskActorInput & {
  retryCount: number;
  result: { output: TaskOutput; usage: TokenUsage } | null;
  lastError: string | null;
};

export const taskActorMachine = setup({
  types: {
    input: {} as TaskActorInput,
    context: {} as TaskActorContext,
    output: {} as
      | { output: TaskOutput; usage: TokenUsage }
      | { error: string; retryCount: number },
  },
  actors: {
    executeTask: fromPromise(
      async ({
        input,
      }: {
        input: {
          task: PlannedTask;
          tools: Record<string, Tool>;
          executeTask: TaskActorInput["executeTask"];
        };
      }) => input.executeTask({ task: input.task, tools: input.tools }),
    ),
  },
}).createMachine({
  id: "taskActor",
  initial: "running",
  context: ({ input }) => ({
    ...input,
    retryCount: 0,
    result: null,
    lastError: null,
  }),
  output: ({ context }) => {
    if (context.result) return context.result;
    return {
      error: context.lastError ?? "unknown error",
      retryCount: context.retryCount,
    };
  },
  states: {
    running: {
      invoke: {
        src: "executeTask",
        input: ({ context }) => ({
          task: context.task,
          tools: context.tools,
          executeTask: context.executeTask,
        }),
        onDone: {
          target: "done",
          actions: assign({ result: ({ event }) => event.output }),
        },
        onError: [
          {
            guard: ({ context }) => context.retryCount < context.maxTaskRetries,
            target: "retrying",
            actions: assign({
              retryCount: ({ context }) => context.retryCount + 1,
              lastError: ({ event }) => String((event.error as Error).message),
            }),
          },
          {
            target: "failed",
            actions: assign({
              lastError: ({ event }) => String((event.error as Error).message),
            }),
          },
        ],
      },
    },
    retrying: {
      always: "running",
    },
    done: { type: "final" },
    failed: { type: "final" },
  },
});
