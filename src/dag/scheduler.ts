import type { PlannedTask, TaskStatus, TaskPlan } from "../types.ts";

export function getReadyTasks(
  tasks: Record<string, TaskStatus>,
  plan: TaskPlan,
  maxConcurrency: number,
): PlannedTask[] {
  const cap =
    Math.min(maxConcurrency, plan.maxConcurrency) -
    Object.values(tasks).filter((s) => s.status === "running").length;

  const ready: PlannedTask[] = [];
  for (const task of plan.tasks) {
    if (cap <= ready.length) break;
    if (task.taskId in tasks) continue;
    const depStatuses = task.dependsOn.map((id) => tasks[id]?.status);
    if (depStatuses.some((s) => s === "failed" || s === "skipped")) continue;
    if (depStatuses.some((s) => s !== "done")) continue;
    ready.push(task);
  }
  return ready;
}
