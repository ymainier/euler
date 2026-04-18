#!/usr/bin/env -S node --strip-types --disable-warning=ExperimentalWarning
/**
 * Resume smoke — demonstrates crash/resume using runAgent + resumeAgent.
 *
 * This script runs two phases:
 *   Phase 1 (--run):    calls runAgent, which saves a checkpoint at the
 *                       "reflecting" state. Kill the process here to simulate
 *                       a crash (Ctrl+C after you see the [checkpoint] line).
 *   Phase 2 (--resume): calls resumeAgent with the saved runId to continue
 *                       from the last checkpoint.
 *
 * Setup (pick a provider):
 *   pnpm add @ai-sdk/openai        # then swap in: openai("gpt-4o")
 *   pnpm add @ai-sdk/anthropic     # then swap in: anthropic("claude-opus-4-6")
 *
 * Run:
 *   node --strip-types examples/resume-smoke.ts --run    <run-id>
 *   node --strip-types examples/resume-smoke.ts --resume <run-id>
 */

import type { LanguageModel } from "ai";
import { runAgent, resumeAgent } from "../src/index.ts";
import type { HarnessConfig } from "../src/index.ts";

// ---------------------------------------------------------------------------
// Swap in a real model before running:
//
//   import { openai } from "@ai-sdk/openai";
//   const model: LanguageModel = openai("gpt-4o");
// ---------------------------------------------------------------------------
const model = null as unknown as LanguageModel;

const DB_PATH = "resume-smoke.db";

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
  db: { path: DB_PATH },
};

async function streamEvents(gen: ReturnType<typeof runAgent>) {
  while (true) {
    const { value, done } = await gen.next();

    if (done) {
      console.log();
      switch (value.kind) {
        case "done":
          console.log(`Answer:     ${value.answer}`);
          console.log(
            `Confidence: ${value.confidence?.score} — ${value.confidence?.reasoning}`,
          );
          console.log(`Tokens:     ${value.tokenUsage?.totalTokens}`);
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
        console.log(
          `\nCheckpoint saved. You can now kill this process and run:`,
        );
        console.log(
          `  node --strip-types examples/resume-smoke.ts --resume ${event.runId}`,
        );
        break;
    }
  }
}

const [, , flag, runId] = process.argv;

if (flag === "--run") {
  const id = runId ?? crypto.randomUUID();
  console.log(`Starting run: ${id}\n`);
  await streamEvents(runAgent("What is the capital of France?", config));
} else if (flag === "--resume") {
  if (!runId) {
    console.error("Usage: resume-smoke.ts --resume <run-id>");
    process.exit(1);
  }
  console.log(`Resuming run: ${runId}\n`);
  await streamEvents(resumeAgent(runId, config));
} else {
  console.log("Usage:");
  console.log(
    "  node --strip-types examples/resume-smoke.ts --run              # start a new run",
  );
  console.log(
    "  node --strip-types examples/resume-smoke.ts --resume <run-id>  # resume after crash",
  );
}
