import { describe, it } from "vitest";
import { detectCycle } from "./cycleDetector.ts";

describe("detectCycle", () => {
  it.todo("detects self-loop");
  it.todo("detects 2-node cycle");
  it.todo("detects 3-node cycle");
  it.todo("detects cycle in one component of a disconnected DAG");
  it.todo("returns null for a diamond (no cycle)");
  it.todo("returns null for an empty plan");
  it.todo("returns null for a single node");
  it.todo("returns null for a deep chain");
});

// Silence unused import warning
void detectCycle;
