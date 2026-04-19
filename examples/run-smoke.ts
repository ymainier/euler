#!/usr/bin/env -S node --strip-types --disable-warning=ExperimentalWarning
/**
 * Run smoke — demonstrates end-to-end usage of runAgent.
 *
 * Run:
 *   node --strip-types examples/run-smoke.ts "What is the capital of France?"
 */

import type { LanguageModel } from "ai";
import { runAgent } from "../src/index.ts";
import type { HarnessConfig } from "../src/index.ts";
import { setupTelemetry } from "../src/telemetry.ts";

// ---------------------------------------------------------------------------
// 1. Swap in a real model before running: use completions provdided by TS
// ---------------------------------------------------------------------------
const model: LanguageModel = "openai/gpt-5.4-nano";

const config: HarnessConfig = {
  roles: {
    planner: {
      model,
      systemPrompt:
        "You are a planning assistant. Break the user's goal into a list of concrete, independent tasks.",
    },
    executor: {
      model,
      systemPrompt:
        "You are a task executor. Complete the given task and return a clear result.",
    },
    reflector: {
      model,
      systemPrompt:
        "You are a reflection assistant. Evaluate whether the completed tasks fully answered the goal.",
    },
  },
  maxConcurrentTasks: 2,
  maxReplanCount: 2,
  maxTaskRetries: 1,
  maxTaskSteps: 5,
  taskTimeoutMs: 30_000,
  tools: {},
  db: { path: "run-smoke.db" },
};

const goal = process.argv[2] ?? "What is the capital of France?";
console.log(`Goal: ${goal}\n`);

setupTelemetry();
const gen = runAgent(goal, config);

while (true) {
  const { value, done } = await gen.next();

  if (done) {
    console.log();
    switch (value.kind) {
      case "done":
        console.log(`Answer:     ${value.answer}`);
        console.log(
          `Confidence: ${value.confidence.score} — ${value.confidence.reasoning}`,
        );
        console.log(`Tokens:     ${value.tokenUsage.totalTokens}`);
        console.log(`Duration:   ${value.durationMs}ms`);
        break;
      case "escalated":
        console.log(`Escalated: ${value.reasoning}`);
        if (value.partialAnswer)
          console.log(`Partial:   ${value.partialAnswer}`);
        break;
      case "error":
        console.error(`Error: ${value.message}`);
        process.exit(1);
    }
    break;
  }

  const event = value;
  switch (event.type) {
    case "planning":
      console.log(`[planning]      replanCount=${event.replanCount}`);
      break;
    case "task_spawned":
      console.log(`[task_spawned]  ${event.taskId}: ${event.description}`);
      break;
    case "task_done":
      console.log(
        `[task_done]     ${event.taskId} (${event.durationMs}ms, ${event.tokenUsage.totalTokens} tokens)`,
      );
      break;
    case "task_failed":
      console.log(
        `[task_failed]   ${event.taskId}: ${event.error} (${event.retriesLeft} retries left)`,
      );
      break;
    case "task_skipped":
      console.log(`[task_skipped]  ${event.taskId}: ${event.reason}`);
      break;
    case "reflecting":
      console.log(
        `[reflecting]    completed=${event.completedTasks} skipped=${event.skippedTasks}`,
      );
      break;
    case "checkpoint":
      console.log(`[checkpoint]    runId=${event.runId} at=${event.at}`);
      break;
  }
}
