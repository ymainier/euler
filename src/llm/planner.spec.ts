import { describe, it } from "vitest";
import { plan } from "./planner.ts";

describe("plan", () => {
  it.todo("returns a validated TaskPlan from mocked LanguageModel");
  it.todo("extracts token usage from the SDK response");
  it.todo("includes feedback in the prompt when provided");
  it.todo("rejects when the timeout expires");
});

void plan;
