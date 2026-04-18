import type { PlannedTask } from "../types.ts";

type Color = "white" | "grey" | "black";

export function detectCycle(tasks: PlannedTask[]): string | null {
  const color = new Map<string, Color>();
  const adj = new Map<string, string[]>();

  for (const t of tasks) {
    color.set(t.taskId, "white");
    adj.set(t.taskId, t.dependsOn);
  }

  function dfs(id: string): string | null {
    color.set(id, "grey");
    for (const dep of adj.get(id) ?? []) {
      if (color.get(dep) === "grey") {
        return `cycle detected between "${id}" and "${dep}"`;
      }
      if (color.get(dep) === "white") {
        const result = dfs(dep);
        if (result !== null) return result;
      }
    }
    color.set(id, "black");
    return null;
  }

  for (const t of tasks) {
    if (color.get(t.taskId) === "white") {
      const result = dfs(t.taskId);
      if (result !== null) return result;
    }
  }

  return null;
}
