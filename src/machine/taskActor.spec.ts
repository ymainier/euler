import { describe, expect, it } from "vitest";
import { createActor, waitFor } from "xstate";
import type { TaskOutput, TokenUsage } from "../types.ts";
import { taskActorMachine } from "./taskActor.ts";

const makeTask = () => ({
  taskId: "t1",
  description: "do something",
  tools: [],
  dependsOn: [],
});

const makeOutput = (): TaskOutput => ({
  taskId: "t1",
  result: "done",
  toolsUsed: [],
});

const makeUsage = (): TokenUsage => ({
  promptTokens: 10,
  completionTokens: 20,
  totalTokens: 30,
});

describe("taskActorMachine", () => {
  it("reaches done with output and usage on first-try success", async () => {
    const executeTask = async () => ({
      output: makeOutput(),
      usage: makeUsage(),
    });

    const actor = createActor(taskActorMachine, {
      input: {
        task: makeTask(),
        tools: {},
        executeTask,
        maxTaskRetries: 2,
      },
    }).start();

    const snapshot = await waitFor(actor, (s) => s.status === "done");

    expect(snapshot.output).toEqual({
      output: makeOutput(),
      usage: makeUsage(),
    });
  });

  it("retries on failure and resolves when a later attempt succeeds", async () => {
    let callCount = 0;
    const executeTask = async () => {
      callCount++;
      if (callCount === 1) throw new Error("transient error");
      return { output: makeOutput(), usage: makeUsage() };
    };

    const actor = createActor(taskActorMachine, {
      input: { task: makeTask(), tools: {}, executeTask, maxTaskRetries: 2 },
    }).start();

    const snapshot = await waitFor(actor, (s) => s.status === "done");

    expect(callCount).toBe(2);
    expect(snapshot.output).toEqual({
      output: makeOutput(),
      usage: makeUsage(),
    });
  });

  it("reaches failed state with error and retryCount after exhausting retries", async () => {
    const executeTask = async () => {
      throw new Error("persistent error");
    };

    const actor = createActor(taskActorMachine, {
      input: { task: makeTask(), tools: {}, executeTask, maxTaskRetries: 2 },
    }).start();

    const snapshot = await waitFor(actor, (s) => s.status === "done");

    expect(snapshot.output).toEqual({
      error: "persistent error",
      retryCount: 2,
    });
  });
});
