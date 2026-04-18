import { assert, describe, expect, it } from "vitest";
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
    });
    expect(result.success).toBe(true);
  });

  it("TaskPlanSchema applies default maxConcurrency of 4", () => {
    const result = TaskPlanSchema.safeParse({
      reasoning: "r",
      tasks: [],
      canParallelize: true,
    });
    expect(result.success).toBe(true);
    assert(result.success);
    expect(result.data.maxConcurrency).toBe(4);
  });

  it("TaskPlanSchema applies default dependsOn of []", () => {
    const result = TaskPlanSchema.safeParse({
      reasoning: "r",
      tasks: [{ taskId: "t1", description: "d", tools: [] }],
      canParallelize: false,
    });
    expect(result.success).toBe(true);
    assert(result.success);
    expect(result.data.tasks[0]?.dependsOn).toEqual([]);
  });

  it("ReflectionOutputSchema validates a done decision", () => {
    const result = ReflectionOutputSchema.safeParse({
      decision: "done",
      answer: "42",
      reasoning: "computed",
      confidence: { score: 0.99, reasoning: "high" },
    });
    expect(result.success).toBe(true);
  });

  it("ReflectionOutputSchema validates a replan decision", () => {
    const result = ReflectionOutputSchema.safeParse({
      decision: "replan",
      reasoning: "missing info",
      feedback: "try harder",
      skippedTasks: ["t2"],
      confidence: { score: 0.4, reasoning: "low" },
    });
    expect(result.success).toBe(true);
  });

  it("ReflectionOutputSchema validates an escalate decision", () => {
    const result = ReflectionOutputSchema.safeParse({
      decision: "escalate",
      reasoning: "impossible",
      confidence: { score: 0.1, reasoning: "very low" },
    });
    expect(result.success).toBe(true);
  });

  it("ReflectionOutputSchema rejects unknown decision", () => {
    const result = ReflectionOutputSchema.safeParse({
      decision: "give_up",
      reasoning: "nah",
    });
    expect(result.success).toBe(false);
  });
});
