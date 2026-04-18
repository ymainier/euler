import { generateText, stepCountIs } from "ai";
import type { Tool } from "ai";
import type {
  PlannedTask,
  TaskOutput,
  TokenUsage,
  RoleConfig,
} from "../types.ts";

export async function executeTask(args: {
  task: PlannedTask;
  tools: Record<string, Tool>;
  config: RoleConfig;
  maxSteps: number;
  timeoutMs: number;
}): Promise<{ output: TaskOutput; usage: TokenUsage }> {
  const { task, tools, config, maxSteps, timeoutMs } = args;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Task timed out after ${timeoutMs}ms`)),
      timeoutMs,
    ),
  );

  const call = generateText({
    model: config.model,
    system: config.systemPrompt,
    prompt: task.description,
    tools,
    stopWhen: stepCountIs(maxSteps),
  });

  const result = await Promise.race([call, timeoutPromise]);

  return {
    output: {
      taskId: task.taskId,
      result: result.text,
      toolsUsed: result.steps.flatMap((s) =>
        s.toolCalls.map((tc) => tc.toolName),
      ),
    },
    usage: {
      promptTokens: result.usage.inputTokens ?? 0,
      completionTokens: result.usage.outputTokens ?? 0,
      totalTokens: result.usage.totalTokens ?? 0,
    },
  };
}
