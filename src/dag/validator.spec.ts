import { describe, it } from "vitest";
import { validatePlan } from "./validator.ts";

describe("validatePlan", () => {
  it.todo("returns an error for a dangling dependsOn reference");
  it.todo("returns an error for a cycle");
  it.todo("returns an error when both cycle and dangling ref exist");
  it.todo("returns null for a valid plan");
});

void validatePlan;
