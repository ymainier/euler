import { describe, it } from "vitest";
import { CheckpointStore } from "./store.ts";

describe("CheckpointStore", () => {
  it.todo("save/load round-trip with in-memory SQLite");
  it.todo("load of missing runId returns null");
  it.todo("overwrite on re-save");
  it.todo("listRuns returns all saved run IDs");
  it.todo("delete removes a run");
  it.todo("strips actorRef from running tasks at save time");
});

void CheckpointStore;
