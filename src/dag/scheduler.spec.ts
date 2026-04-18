import { describe, it } from "vitest";
import { getReadyTasks } from "./scheduler.ts";

describe("getReadyTasks", () => {
  it.todo("returns nothing when all deps are pending");
  it.todo("returns all tasks when none have dependencies");
  it.todo("returns only tasks whose deps are done");
  it.todo("respects the concurrency cap");
  it.todo("excludes already-spawned tasks");
  it.todo("excludes tasks with failed dependencies");
  it.todo("excludes tasks with skipped dependencies");
});

void getReadyTasks;
