import { generateText, Output } from "ai";
import type { ModelMessage } from "ai";
import {
  TaskPlanSchema,
  type TaskPlan,
  type TokenUsage,
  type RoleConfig,
} from "../types.ts";

export async function plan(args: {
  goal: string;
  messages: ModelMessage[];
  feedback: string | null;
  config: RoleConfig;
  timeoutMs: number;
}): Promise<{ plan: TaskPlan; usage: TokenUsage }> {
  const { goal, messages, feedback, config, timeoutMs } = args;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Task timed out after ${timeoutMs}ms`)),
      timeoutMs,
    ),
  );

  const systemPrompt = feedback
    ? `${config.systemPrompt}\n\nPrevious attempt feedback:\n${feedback}`
    : config.systemPrompt;

  const call = generateText({
    model: config.model,
    output: Output.object({ schema: TaskPlanSchema }),
    system: systemPrompt,
    messages: [...messages, { role: "user", content: goal }],
    experimental_telemetry: { isEnabled: true, functionId: "planner" },
  });

  const result = await Promise.race([call, timeoutPromise]);

  return {
    plan: result.output,
    usage: {
      promptTokens: result.usage.inputTokens ?? 0,
      completionTokens: result.usage.outputTokens ?? 0,
      totalTokens: result.usage.totalTokens ?? 0,
    },
  };
}
