import type { TaskPlan } from "../types.ts";
import { detectCycle } from "./cycleDetector.ts";

export function validatePlan(plan: TaskPlan): string | null {
  const ids = new Set(plan.tasks.map((t) => t.taskId));
  for (const task of plan.tasks) {
    for (const dep of task.dependsOn) {
      if (!ids.has(dep)) {
        return `task "${task.taskId}" depends on unknown taskId "${dep}"`;
      }
    }
  }
  return detectCycle(plan.tasks);
}
