import { describe, it } from "vitest";

describe("agentMachine", () => {
  it.todo("happy path: planning → executing → reflecting → done");
  it.todo("cycle detected → replan → succeed");
  it.todo("task failure → skip dependents → reflector sees skip list");
  it.todo("max replan exceeded → escalate");
  it.todo("plan invalid beyond retry limit → failed state");
});
