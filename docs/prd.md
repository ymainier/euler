# PRD: Statechart-Based Agent Harness

## Problem Statement

Building an LLM agent that can plan, execute parallel tasks with dependencies, spawn subagents, reflect on results, and recover from crashes usually results in a tangle of ad-hoc async orchestration (nested promises, scattered conditionals, implicit state). This is hard to reason about, hard to test without hitting the LLM, hard to visualise, and hard to formally verify. When the process crashes mid-run, all work is lost.

I want an agent harness built on an **explicit statechart** (XState v5) so that control flow, parallelism, and failure handling are declarative, inspectable, serialisable, and testable without LLM calls.

## Solution

A Node.js library, built on top of the Vercel AI SDK and XState v5, that exposes a single async generator entry point `runAgent(goal, config)` and a companion `resumeAgent(runId, config)`. Internally the harness is modelled as a hierarchical, concurrent statechart:

- A **planning** state invokes an LLM that emits a structured DAG of tasks (Zod-validated).
- An **executing** state dynamically spawns one XState actor per task, respecting a DAG scheduler with a concurrency ceiling.
- Each task actor runs its own `generateText` loop with a per-task tool allowlist (least-privilege), reports output (or failure) back to the parent via `onDone`.
- A **reflecting** state calls an LLM that decides between `done`, `replan`, or `escalate`.
- At states explicitly marked `meta: { checkpoint: true }`, the full machine snapshot + conversation history is persisted to SQLite so the run can be resumed after a crash.
- Progress is streamed to the caller as a typed `AgentEvent` async iterator, carrying token usage and duration on every task and terminal event.

The public surface is tiny. The depth is in the scheduler, the LLM wrappers, and the checkpoint store — all of which are pure or near-pure modules that can be unit-tested without LLM access.

## User Stories

### Core execution

1. As a harness caller, I want to invoke `runAgent(goal, config)` and receive an async generator, so that I can stream progress to my UI or HTTP response in real time.
2. As a harness caller, I want a single planning step to produce a DAG of tasks from my goal, so that complex goals are decomposed into independent units of work.
3. As a harness caller, I want tasks without inter-dependencies to execute in parallel, so that total wall time is minimised.
4. As a harness caller, I want dependent tasks to wait for their prerequisites, so that downstream tasks see the outputs of upstream ones.
5. As a harness caller, I want task parallelism capped by a configurable hard ceiling, so that I never exceed API rate limits or memory budgets regardless of what the planner decides.
6. As a harness caller, I want the planner to be able to suggest a per-run concurrency hint within the hard ceiling, so that IO-bound plans can fan out wider than CPU-bound ones.
7. As a harness caller, I want a reflection step after all tasks complete, so that the harness either returns a final answer, replans, or escalates gracefully.
8. As a harness caller, I want replan cycles capped by a configurable limit, so that the agent cannot loop forever on impossible goals.

### Planning and DAG validation

9. As a harness caller, I want the planner output to be validated against a Zod schema, so that malformed LLM output is caught before execution.
10. As a harness caller, I want the harness to detect cycles in the task DAG, so that the planner is not trusted with graph invariants.
11. As a harness caller, I want the harness to detect dangling `dependsOn` references, so that tasks cannot reference non-existent prerequisites.
12. As a harness caller, I want the harness to re-prompt the planner with a concrete error message when its plan is invalid, so that the LLM has a chance to fix its own mistake.
13. As a harness caller, I want re-prompting capped at a small number of attempts, so that a stubborn planner cannot waste unlimited tokens.

### Subagents and parallel task execution

14. As a harness caller, I want each task modelled as an independent XState actor, so that task lifecycle is isolated and composable.
15. As a harness caller, I want a task actor to retry internally up to a configurable limit before reporting failure to the parent, so that transient errors don't immediately abort the run.
16. As a harness caller, I want task-level timeouts so that runaway LLM calls can be cut short.
17. As a harness caller, I want timeouts to be treated as a flavour of failure, so that existing retry/skip logic handles them uniformly.
18. As a harness caller, I want permanently failed tasks to mark their dependents as `skipped` instead of propagating failure, so that the reflector can make an informed recovery decision.
19. As a harness caller, I want every task to receive only the subset of tools explicitly authorised by the planner, so that tool access follows least-privilege.
20. As a harness caller, I want the global tool registry defined once at harness startup, so that tool configuration is centralised.
21. As a harness caller, I want tasks to reuse the Vercel AI SDK internal tool-calling loop (`generateText` with `maxSteps`), so that I don't reinvent tool orchestration.

### Reflection and decisions

22. As a harness caller, I want the reflection output to be a Zod-validated discriminated union (`done` | `replan` | `escalate`), so that downstream handling is type-safe and exhaustive.
23. As a harness caller, I want every reflection decision to carry a confidence score and reasoning, so that I can surface them in the final output without the harness imposing a policy.
24. As a harness caller, I want `escalate` to optionally include a partial answer, so that I can surface best-effort results when the goal is unachievable.
25. As a harness caller, I want confidence scores to be purely informational, so that I (the caller) own the policy for what to do with low-confidence results.

### Persistence and resume

26. As a harness caller, I want checkpoints written only at states explicitly marked `meta: { checkpoint: true }`, so that recovery points are intentional and unambiguous.
27. As a harness caller, I want each checkpoint to contain the complete machine snapshot plus conversation history as a single atomic SQLite write, so that recovery is consistent.
28. As a harness caller, I want non-serialisable actor references to be stripped from running tasks at checkpoint time, so that the snapshot can be round-tripped through JSON.
29. As a harness caller, I want to call `resumeAgent(runId, config)` to continue a crashed run from its last checkpoint, so that long-running agent work is not lost.
30. As a harness caller, I want resumed runs to respawn in-flight tasks from scratch, so that the machine returns to a known-good state without half-complete actor state.
31. As a harness caller, I want cumulative token usage to survive checkpoints, so that resume-after-crash does not lose cost tracking.

### Observability

32. As a harness caller, I want to subscribe to a typed `AgentEvent` stream covering planning, task spawn/done/fail/skip, reflecting, checkpoint, done, escalated, and error, so that I can drive real-time progress UI.
33. As a harness caller, I want task-level events to carry per-task token usage and duration, so that I can profile cost and latency per step.
34. As a harness caller, I want terminal events (`done`, `escalated`) to carry cumulative run token usage and duration, so that I can report total cost to the user.

### Configuration

35. As a harness caller, I want to configure different models for planning, execution, and reflection, so that I can trade off cost against quality per role.
36. As a harness caller, I want to configure a distinct system prompt for each role, so that the LLM's behaviour is role-appropriate.
37. As a harness caller, I want to configure `maxConcurrentTasks`, `maxReplanCount`, `maxTaskRetries`, `maxTaskSteps`, and `taskTimeoutMs`, so that all runtime limits are explicit and tunable.
38. As a harness caller, I want to configure the SQLite database path, so that I can control where checkpoints are stored.

### Testability

39. As a module author, I want the DAG scheduler and cycle detector to be pure functions, so that I can unit-test them exhaustively without any XState or LLM involvement.
40. As a module author, I want the checkpoint store to accept an in-memory SQLite instance, so that I can test round-trips without touching the filesystem.
41. As a module author, I want the LLM wrappers to accept a `LanguageModel` instance, so that I can inject a mock in tests without stubbing the Vercel AI SDK internals.
42. As a module author, I want the XState machine to be testable against a mocked LLM module, so that state-transition correctness can be verified without API calls.

## Implementation Decisions

### Repository conventions (inherited from `ymainier/euler`)

- Node.js with `--strip-types` flag — **no build step**, TypeScript runs directly via `node --watch --strip-types`.
- ESM only (`"type": "module"` in `package.json`). Use `.ts` extensions in relative imports where required by Node's ESM resolver.
- Vitest for tests (`pnpm test`).
- ESLint + Prettier with default `.prettierrc` config.
- pnpm as the package manager.
- TypeScript, function declarations over function expressions, descriptive type names, `thing ? 'x' : null` over `thing && 'x'`.

### New dependencies

- `ai` — Vercel AI SDK (LLM calls, `generateObject`, `generateText`, `tool`).
- `xstate` — v5 (statechart, actors).
- `zod` — schema validation for planner and reflector outputs.

Node built-ins:
- `node:sqlite` — synchronous SQLite driver built into Node.js (stable since v22.5 with `--experimental-sqlite` flag, unflagged in v24+). No native build step, no extra dependency. Matches XState's synchronous transition semantics. Requires Node 22+ (the repo's `.nvmrc` should be verified — see acceptance criteria).

### Module layout under `src/`

```
src/
  index.ts                    # public exports
  types.ts                    # shared types + Zod schemas
  dag/
    cycleDetector.ts          # DFS three-colour cycle detection
    validator.ts              # cycle + dangling-ref validation, returns string | null
    scheduler.ts              # getReadyTasks: pure DAG scheduler with concurrency cap
    cycleDetector.test.ts
    validator.test.ts
    scheduler.test.ts
  checkpoint/
    store.ts                  # CheckpointStore class, SQLite + JSON, snapshot sanitisation
    store.test.ts             # uses :memory: SQLite
  llm/
    planner.ts                # plan(goal, messages, feedback?, config) -> { plan, usage }
    reflector.ts              # reflect(goal, tasks, messages, config) -> { output, usage }
    executor.ts               # executeTask(task, tools, config) -> { output, usage }
    planner.test.ts
    reflector.test.ts
    executor.test.ts
  tools/
    registry.ts               # ToolRegistry class: register, getSubset, list
  machine/
    agentMachine.ts           # setup().createMachine(...) definition
    actions.ts                # pure action functions (assign bodies etc.)
    guards.ts                 # pure guard functions
    taskActor.ts              # task actor machine definition
    agentMachine.test.ts      # integration tests with mocked llm module
  harness/
    runAgent.ts               # public async generator entry point
  resume/
    resume.ts                 # resumeAgent, respawns in-flight tasks
    resume.test.ts            # crash/resume round-trip with mocked llm
```

### Deep modules (testable in isolation)

- **`dag/`** — pure functions, no I/O, no XState, no LLM. Tests cover: self-loops, disconnected components, diamond dependencies, empty plans, single-node plans, dangling refs, concurrency-capped scheduling, eager spawning on task completion.
- **`checkpoint/`** — interface is four methods (`save`, `load`, `delete`, `listRuns`). Tests use `node:sqlite` `DatabaseSync` with `:memory:`. Covers: round-trip, missing keys, actor-ref stripping, multiple runs, overwrite semantics.
- **`llm/`** — each wrapper is one async function. Tests inject a mock `LanguageModel`. Cover: schema-validated outputs, timeout behaviour (`Promise.race`), token-usage extraction, prompt assembly (snapshot-test the assembled prompt strings).
- **`machine/`** — integration tests using mocked `llm/` module. Covers: planning → executing → reflecting → done happy path, cycle detection → replan → continue, task failure → skip dependents, max replan → escalate.

### Shallow modules (light or no direct tests)

- **`tools/registry`** — a thin `Record<string, Tool>` wrapper. Smoke test only.
- **`types.ts`** — no logic.
- **`harness/runAgent`** — public surface, exercised implicitly by machine integration tests.
- **`resume/`** — one E2E integration test: run to checkpoint, simulate crash, resume, complete.

### Shared types and schemas (`src/types.ts`)

```typescript
import { z } from "zod";
import type { AnyActorRef } from "xstate";
import type { CoreMessage, LanguageModel, Tool } from "ai";

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type ConfidenceScore = {
  score: number; // 0.0 - 1.0
  reasoning: string;
};

export const ConfidenceSchema = z.object({
  score: z.number().min(0).max(1),
  reasoning: z.string(),
});

export const TaskPlanSchema = z.object({
  reasoning: z.string(),
  tasks: z.array(
    z.object({
      taskId: z.string(),
      description: z.string(),
      tools: z.array(z.string()),
      dependsOn: z.array(z.string()).default([]),
    })
  ),
  canParallelize: z.boolean(),
  maxConcurrency: z.number().int().min(1).max(10).default(4),
});
export type TaskPlan = z.infer<typeof TaskPlanSchema>;
export type PlannedTask = TaskPlan["tasks"][number];

export const ReflectionOutputSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("done"),
    answer: z.string(),
    reasoning: z.string(),
    confidence: ConfidenceSchema,
  }),
  z.object({
    decision: z.literal("replan"),
    reasoning: z.string(),
    feedback: z.string(),
    skippedTasks: z.array(z.string()),
    confidence: ConfidenceSchema,
  }),
  z.object({
    decision: z.literal("escalate"),
    reasoning: z.string(),
    partialAnswer: z.string().optional(),
    confidence: ConfidenceSchema,
  }),
]);
export type ReflectionOutput = z.infer<typeof ReflectionOutputSchema>;

export type TaskOutput = {
  taskId: string;
  result: string;
  toolsUsed: string[];
};

export type TaskStatus =
  | { status: "running"; actorRef: AnyActorRef; startedAt: number }
  | { status: "done"; output: TaskOutput; durationMs: number; tokenUsage: TokenUsage }
  | { status: "failed"; error: string; retryCount: number; durationMs: number }
  | { status: "skipped"; reason: string };

export type AgentContext = {
  runId: string;
  taskGoal: string;
  messages: CoreMessage[];
  toolResults: TaskOutput[];
  tasks: Record<string, TaskStatus>;
  currentPlan: TaskPlan | null;
  replanCount: number;
  planValidationFeedback: string | null;
  totalTokenUsage: TokenUsage;
  startedAt: number;
  checkpointAt: string | null;
  lastError: string | null;
};

export type AgentEvent =
  | { type: "planning"; replanCount: number }
  | { type: "task_spawned"; taskId: string; description: string }
  | { type: "task_done"; taskId: string; output: TaskOutput; tokenUsage: TokenUsage; durationMs: number }
  | { type: "task_failed"; taskId: string; error: string; retriesLeft: number; durationMs: number }
  | { type: "task_skipped"; taskId: string; reason: string }
  | { type: "reflecting"; completedTasks: number; skippedTasks: number }
  | { type: "checkpoint"; runId: string; at: string }
  | { type: "done"; answer: string; confidence: ConfidenceScore; tokenUsage: TokenUsage; durationMs: number }
  | { type: "escalated"; reasoning: string; partialAnswer?: string; confidence: ConfidenceScore; tokenUsage: TokenUsage; durationMs: number }
  | { type: "error"; message: string };

export type RoleConfig = {
  model: LanguageModel;
  systemPrompt: string;
};

export type HarnessConfig = {
  roles: {
    planner: RoleConfig;
    executor: RoleConfig;
    reflector: RoleConfig;
  };
  maxConcurrentTasks: number;
  maxReplanCount: number;
  maxTaskRetries: number;
  maxTaskSteps: number;
  taskTimeoutMs: number;
  tools: Record<string, Tool>;
  db: { path: string };
};
```

### DAG module interfaces (`src/dag/`)

```typescript
// cycleDetector.ts
export function detectCycle(tasks: PlannedTask[]): string | null;

// validator.ts — cycle + dangling refs
export function validatePlan(plan: TaskPlan): string | null;

// scheduler.ts
export type ReadyTask = { task: PlannedTask };
export function getReadyTasks(
  tasks: Record<string, TaskStatus>,
  plan: TaskPlan,
  maxConcurrency: number
): PlannedTask[];
```

Cycle detection uses DFS with white/grey/black marking. Returns a human-readable cycle description (e.g. `"cycle detected between \"A\" and \"C\""`) suitable for feeding back into the planner prompt.

Scheduler is a pure function of `(tasksStatus, plan, maxConcurrency)` returning the list of tasks to spawn right now. It must:
- skip tasks already present in `tasksStatus` (spawned or complete),
- include only tasks whose every `dependsOn` entry is `done` in `tasksStatus`,
- exclude tasks whose any `dependsOn` entry is `failed` or `skipped` (those will be marked `skipped` separately),
- respect the effective concurrency limit `min(maxConcurrency, plan.maxConcurrency)`, subtracting the number of currently-running tasks.

### Checkpoint store interface (`src/checkpoint/store.ts`)

```typescript
import type { Snapshot } from "xstate";
import type { AgentContext } from "../types.ts";

export type CheckpointRecord = {
  runId: string;
  snapshot: Snapshot<unknown>;
  context: AgentContext;
  savedAt: string; // ISO
};

export class CheckpointStore {
  constructor(dbPath: string); // pass ":memory:" for tests
  save(runId: string, snapshot: Snapshot<unknown>, context: AgentContext): void;
  load(runId: string): CheckpointRecord | null;
  delete(runId: string): void;
  listRuns(): string[];
  close(): void;
}
```

Implementation notes:
- Uses `DatabaseSync` from `node:sqlite` (synchronous API by design).
- Single table `checkpoints(run_id TEXT PRIMARY KEY, snapshot_json TEXT, context_json TEXT, saved_at TEXT)`.
- Before serialising `context.tasks`, transform each `running` entry into a placeholder `{ status: "running", startedAt }` (drop the `actorRef`). On load, running tasks are returned as-is; the resume module re-spawns fresh actors for them.
- All methods synchronous (matches XState transition semantics and `node:sqlite`'s `DatabaseSync` API).
- For tests, instantiate with `":memory:"` — `node:sqlite` supports in-memory databases the same way `better-sqlite3` does.

### LLM role wrappers (`src/llm/`)

```typescript
// planner.ts
export async function plan(args: {
  goal: string;
  messages: CoreMessage[];
  feedback: string | null; // re-plan feedback (cycle, dangling ref, reflector feedback)
  config: RoleConfig;
  timeoutMs: number;
}): Promise<{ plan: TaskPlan; usage: TokenUsage }>;

// executor.ts
export async function executeTask(args: {
  task: PlannedTask;
  tools: Record<string, Tool>; // already filtered to this task's allowlist
  config: RoleConfig;
  maxSteps: number;
  timeoutMs: number;
}): Promise<{ output: TaskOutput; usage: TokenUsage }>;

// reflector.ts
export async function reflect(args: {
  goal: string;
  tasks: Record<string, TaskStatus>;
  messages: CoreMessage[];
  config: RoleConfig;
  timeoutMs: number;
}): Promise<{ output: ReflectionOutput; usage: TokenUsage }>;
```

Each wrapper:
- Uses `generateObject` for planner/reflector with the Zod schemas, `generateText` with `maxSteps` for executor.
- Wraps the SDK call in `Promise.race([call, timeoutPromise])`. A timeout rejects with `new Error("Task timed out after Nms")`, which is caught by the caller (task actor) and treated as a failure.
- Extracts token usage from the SDK response and returns it alongside the output.

### Tool registry (`src/tools/registry.ts`)

```typescript
export class ToolRegistry {
  constructor(tools: Record<string, Tool>);
  getSubset(names: string[]): Record<string, Tool>; // throws on unknown names
  list(): string[];
}
```

Throwing on unknown names means the planner cannot request tools that don't exist — this surfaces at plan-validation time, and can feed into re-plan feedback (treat as a flavour of invalid plan).

### XState machine structure (`src/machine/agentMachine.ts`)

States:

```
agent
├── planning              [meta: { checkpoint: true }]
│   invoke: plannerActor
│   onDone: validate plan
│     - if invalid and replanCount < max: -> planning (with feedback)
│     - if invalid and replanCount == max: -> failed
│     - if valid: -> executing
├── executing             [meta: { checkpoint: true }]
│   entry: spawnReadyTasks (eager scheduler)
│   on TASK_DONE:         assign, markDependentsSkippedIfNeeded, spawnReadyTasks
│   on TASK_FAILED:       retry-or-fail logic, spawnReadyTasks
│   always [all complete]: -> reflecting
├── reflecting            [meta: { checkpoint: true }]
│   invoke: reflectorActor
│   onDone:
│     - decision 'done'      -> done      (final state)
│     - decision 'replan'    -> planning  (bump replanCount, store feedback)
│     - decision 'escalate'  -> escalated (final state)
├── done       (final, output: { answer, confidence, tokenUsage, durationMs })
├── escalated  (final, output: { reasoning, partialAnswer?, confidence, tokenUsage, durationMs })
└── failed     (final, output: { message })
```

- `meta: { checkpoint: true }` is read by the harness wrapper on every transition. When entering a state with this flag, the wrapper calls `CheckpointStore.save()` and emits a `checkpoint` event.
- Task actors are spawned via `spawn()` inside an assign action. Their refs are stored in `context.tasks[taskId].actorRef`.
- `spawnReadyTasks` delegates to `dag/scheduler.getReadyTasks`. Action body is thin; scheduling logic is pure.
- When a task fails permanently (retries exhausted), an action `markDependentsSkipped` walks the DAG and marks every transitive dependent as `skipped`.

### Task actor (`src/machine/taskActor.ts`)

A small machine per task. States: `running → done | failed`. The `running` state invokes `llm/executor.executeTask`, with internal retry on thrown error (up to `maxTaskRetries`). On exhaustion, final state `failed` with error output. On success, final state `done` with task output. Parent reads it via `onDone`.

Timeouts are enforced inside `executeTask` via `Promise.race`, not via XState `after` transitions (simpler, already covered by the LLM wrapper).

### Public API (`src/harness/runAgent.ts`)

```typescript
export type FinalOutput =
  | { kind: "done"; answer: string; confidence: ConfidenceScore; tokenUsage: TokenUsage; durationMs: number }
  | { kind: "escalated"; reasoning: string; partialAnswer?: string; confidence: ConfidenceScore; tokenUsage: TokenUsage; durationMs: number }
  | { kind: "error"; message: string };

export function runAgent(
  goal: string,
  config: HarnessConfig
): AsyncGenerator<AgentEvent, FinalOutput, void>;
```

Implementation sketch:
1. Generate `runId` (crypto.randomUUID).
2. Create XState actor for the machine with initial context.
3. Subscribe to `actor.subscribe((snapshot) => ...)`: enqueue derived `AgentEvent`s into an internal queue; if the entered state has `meta.checkpoint === true`, also persist snapshot and push a `checkpoint` event.
4. The generator yields events from the queue; completes when the actor reaches a final state, yielding the derived `FinalOutput`.
5. On any unhandled error, yield a terminal `error` event and return `{ kind: "error" }`.

### Resume API (`src/resume/resume.ts`)

```typescript
export function resumeAgent(
  runId: string,
  config: HarnessConfig
): AsyncGenerator<AgentEvent, FinalOutput, void>;
```

1. Load `CheckpointRecord` from store — throw if not found.
2. Reconstruct XState actor with the saved snapshot (`createActor(machine, { snapshot })`).
3. Walk `context.tasks`: for any `running` entries, re-spawn the task actor from scratch with the original task definition (looked up in `context.currentPlan`). Replace the stored status with a fresh `running` entry carrying the new `actorRef`.
4. Proceed as `runAgent` does — subscribe and yield events until final state.

### Public exports (`src/index.ts`)

```typescript
export { runAgent } from "./harness/runAgent.ts";
export { resumeAgent } from "./resume/resume.ts";
export { CheckpointStore } from "./checkpoint/store.ts";
export type {
  HarnessConfig, RoleConfig, AgentEvent, AgentContext,
  TaskPlan, ReflectionOutput, TaskOutput, TaskStatus,
  TokenUsage, ConfidenceScore,
} from "./types.ts";
```

### Testing plan (Vitest)

- `dag/cycleDetector.test.ts` — self-loop, 2-node cycle, 3-node cycle, disconnected DAG with a cycle in one component, diamond (no cycle), empty plan, single node, deep chain.
- `dag/validator.test.ts` — dangling `dependsOn`, cycle, both, valid.
- `dag/scheduler.test.ts` — nothing ready (all deps pending), all ready (no deps), partial ready (some deps done), respects concurrency cap, excludes already-spawned tasks, excludes tasks with failed/skipped deps.
- `checkpoint/store.test.ts` — save/load round-trip with in-memory `node:sqlite`, load of missing runId returns null, overwrite on re-save, `listRuns`, actor-ref stripping preserves other task fields, delete.
- `llm/planner.test.ts` — mocked `LanguageModel`: schema validation passes, usage extracted, feedback passed into prompt when provided, timeout rejects.
- `llm/reflector.test.ts` — each of three decisions parsed correctly, usage extracted, timeout rejects.
- `llm/executor.test.ts` — tool subset passed through, `maxSteps` respected, timeout rejects, output includes `toolsUsed`.
- `machine/agentMachine.test.ts` — integration with mocked llm: happy path, cycle → replan → succeed, failure → skip dependents → reflector sees skip list, max replan → escalate, failed state on plan-invalid beyond retry limit.
- `resume/resume.test.ts` — end-to-end: run to checkpoint, close actor, resume from runId, complete. Verify cumulative token usage preserved, running tasks re-spawned.

### Out of scope for this PRD

- Streaming token output from tasks to the caller (task events are coarse-grained).
- MCP tool support (reachable later via Vercel AI SDK's MCP integration, no harness changes).
- Multi-node / distributed execution (SQLite chosen precisely because single-node is sufficient).
- Automatic policy enforcement on confidence scores (caller-owned).
- Authentication/authorisation of tools by end-user identity.

### Acceptance criteria

- Node version in `.nvmrc` is 22.5+ (for `node:sqlite` support); if the current `.nvmrc` pins an older version, bump it. Node 24+ is preferred (unflagged `node:sqlite`).
- If Node 22.x is used, the harness must pass `--experimental-sqlite` via the `dev`/`test` scripts, or rely on `--no-warnings` + accept the stability warning.
- `pnpm test` passes with the test suite above.
- `pnpm typecheck` passes.
- `pnpm lint` passes.
- A smoke script under `src/index.ts` (or an `examples/` directory) can `runAgent` against a real Vercel AI SDK provider and stream events end-to-end.
- A smoke script can crash a run mid-execution, restart the process, call `resumeAgent`, and produce a complete result.
