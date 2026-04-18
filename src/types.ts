import { z } from "zod";
import type { AnyActorRef } from "xstate";
import type { ModelMessage, LanguageModel, Tool } from "ai";

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
  messages: ModelMessage[];
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
