import { describe, expect, it } from "vitest";
import { detectCycle } from "./cycleDetector.ts";

function task(
  taskId: string,
  dependsOn: string[] = [],
): {
  taskId: string;
  description: string;
  tools: string[];
  dependsOn: string[];
} {
  return { taskId, description: taskId, tools: [], dependsOn };
}

describe("detectCycle", () => {
  it("detects self-loop", () => {
    const result = detectCycle([task("A", ["A"])]);
    expect(result).not.toBeNull();
  });

  it("detects 2-node cycle", () => {
    const result = detectCycle([task("A", ["B"]), task("B", ["A"])]);
    expect(result).not.toBeNull();
  });

  it("detects 3-node cycle", () => {
    const result = detectCycle([
      task("A", ["B"]),
      task("B", ["C"]),
      task("C", ["A"]),
    ]);
    expect(result).not.toBeNull();
  });

  it("detects cycle in one component of a disconnected DAG", () => {
    // Component 1: A → B (no cycle), Component 2: C → C (self-loop)
    const result = detectCycle([task("A", ["B"]), task("B"), task("C", ["C"])]);
    expect(result).not.toBeNull();
  });

  it("returns null for a diamond (no cycle)", () => {
    // A→B, A→C, B→D, C→D
    const result = detectCycle([
      task("A", ["B", "C"]),
      task("B", ["D"]),
      task("C", ["D"]),
      task("D"),
    ]);
    expect(result).toBeNull();
  });

  it("returns null for an empty plan", () => {
    expect(detectCycle([])).toBeNull();
  });

  it("returns null for a single node with no deps", () => {
    expect(detectCycle([task("A")])).toBeNull();
  });

  it("returns null for a deep chain", () => {
    // A→B→C→D→E
    const result = detectCycle([
      task("A", ["B"]),
      task("B", ["C"]),
      task("C", ["D"]),
      task("D", ["E"]),
      task("E"),
    ]);
    expect(result).toBeNull();
  });
});
