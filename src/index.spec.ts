import { describe, expect, it } from "vitest";
import { runAgent, resumeAgent, CheckpointStore } from "./index.ts";
import {
  TaskPlanSchema,
  ReflectionOutputSchema,
  ConfidenceSchema,
} from "./types.ts";

describe("public exports", () => {
  it("exports runAgent as a function", () => {
    expect(typeof runAgent).toBe("function");
  });

  it("exports resumeAgent as a function", () => {
    expect(typeof resumeAgent).toBe("function");
  });

  it("exports CheckpointStore as a class", () => {
    expect(typeof CheckpointStore).toBe("function");
  });
});

describe("Zod schemas", () => {
  it("ConfidenceSchema validates a valid confidence object", () => {
    const result = ConfidenceSchema.safeParse({
      score: 0.8,
      reasoning: "seems good",
    });
    expect(result.success).toBe(true);
  });

  it("ConfidenceSchema rejects score out of range", () => {
    const result = ConfidenceSchema.safeParse({
      score: 1.5,
      reasoning: "too high",
    });
    expect(result.success).toBe(false);
  });

  it("TaskPlanSchema validates a minimal valid plan", () => {
    const result = TaskPlanSchema.safeParse({
      reasoning: "step by step",
      tasks: [
        { taskId: "t1", description: "do thing", tools: [], dependsOn: [] },
      ],
      canParallelize: false,
      maxConcurrency: 1,
    });
    expect(result.success).toBe(true);
  });

  it("TaskPlanSchema requires maxConcurrency", () => {
    const result = TaskPlanSchema.safeParse({
      reasoning: "r",
      tasks: [],
      canParallelize: true,
    });
    expect(result.success).toBe(false);
  });

  it("TaskPlanSchema requires dependsOn on each task", () => {
    const result = TaskPlanSchema.safeParse({
      reasoning: "r",
      tasks: [{ taskId: "t1", description: "d", tools: [] }],
      canParallelize: false,
      maxConcurrency: 1,
    });
    expect(result.success).toBe(false);
  });

  const baseReflection = {
    answer: "",
    feedback: "",
    skippedTasks: [],
    partialAnswer: "",
    confidence: { score: 0.9, reasoning: "ok" },
  };

  it("ReflectionOutputSchema validates a done decision", () => {
    const result = ReflectionOutputSchema.safeParse({
      ...baseReflection,
      decision: "done",
      answer: "42",
      reasoning: "computed",
    });
    expect(result.success).toBe(true);
  });

  it("ReflectionOutputSchema validates a replan decision", () => {
    const result = ReflectionOutputSchema.safeParse({
      ...baseReflection,
      decision: "replan",
      reasoning: "missing info",
      feedback: "try harder",
      skippedTasks: ["t2"],
    });
    expect(result.success).toBe(true);
  });

  it("ReflectionOutputSchema validates an escalate decision", () => {
    const result = ReflectionOutputSchema.safeParse({
      ...baseReflection,
      decision: "escalate",
      reasoning: "impossible",
      partialAnswer: "partial",
    });
    expect(result.success).toBe(true);
  });

  it("ReflectionOutputSchema rejects unknown decision", () => {
    const result = ReflectionOutputSchema.safeParse({
      ...baseReflection,
      decision: "give_up",
      reasoning: "nah",
    });
    expect(result.success).toBe(false);
  });
});
