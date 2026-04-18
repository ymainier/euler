import { describe, expect, it } from "vitest";
import { validatePlan } from "./validator.ts";

const basePlan = {
  reasoning: "test",
  canParallelize: false,
  maxConcurrency: 4,
};

describe("validatePlan", () => {
  it("returns an error for a dangling dependsOn reference", () => {
    const plan = {
      ...basePlan,
      tasks: [
        { taskId: "a", description: "A", tools: [], dependsOn: ["missing"] },
      ],
    };
    const result = validatePlan(plan);
    expect(result).toBeTypeOf("string");
    expect(result).toContain("missing");
  });

  it("returns an error for a cycle", () => {
    const plan = {
      ...basePlan,
      tasks: [
        { taskId: "a", description: "A", tools: [], dependsOn: ["b"] },
        { taskId: "b", description: "B", tools: [], dependsOn: ["a"] },
      ],
    };
    const result = validatePlan(plan);
    expect(result).toBeTypeOf("string");
  });
  it("returns an error when both cycle and dangling ref exist", () => {
    // "a"→"b" cycle, plus "a" also depends on "ghost" (dangling)
    const plan = {
      ...basePlan,
      tasks: [
        { taskId: "a", description: "A", tools: [], dependsOn: ["b", "ghost"] },
        { taskId: "b", description: "B", tools: [], dependsOn: ["a"] },
      ],
    };
    const result = validatePlan(plan);
    expect(result).toBeTypeOf("string");
    expect(result).toContain("ghost");
  });
  it("returns null for a valid plan", () => {
    const plan = {
      ...basePlan,
      tasks: [
        { taskId: "a", description: "A", tools: [], dependsOn: [] },
        { taskId: "b", description: "B", tools: [], dependsOn: ["a"] },
      ],
    };
    expect(validatePlan(plan)).toBeNull();
  });
});
