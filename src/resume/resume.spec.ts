import { describe, it } from "vitest";
import { resumeAgent } from "./resume.ts";

describe("resumeAgent", () => {
  it.todo("runs to checkpoint, crashes, resumes, completes");

  it.todo("cumulative token usage is preserved after resume");

  it.todo("running tasks are re-spawned fresh on resume");
});

void resumeAgent;
