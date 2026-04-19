import { generateText, Output } from "ai";
import type { ModelMessage } from "ai";
import {
  ReflectionOutputSchema,
  type ReflectionOutput,
  type TaskStatus,
  type TokenUsage,
  type RoleConfig,
} from "../types.ts";

export async function reflect(args: {
  goal: string;
  tasks: Record<string, TaskStatus>;
  messages: ModelMessage[];
  config: RoleConfig;
  timeoutMs: number;
}): Promise<{ output: ReflectionOutput; usage: TokenUsage }> {
  const { goal, messages, config, timeoutMs } = args;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Task timed out after ${timeoutMs}ms`)),
      timeoutMs,
    ),
  );

  const call = generateText({
    model: config.model,
    output: Output.object({ schema: ReflectionOutputSchema }),
    system: config.systemPrompt,
    messages: [...messages, { role: "user", content: goal }],
    experimental_telemetry: { isEnabled: true, functionId: "reflector" },
  });

  const result = await Promise.race([call, timeoutPromise]);

  return {
    output: result.output,
    usage: {
      promptTokens: result.usage.inputTokens ?? 0,
      completionTokens: result.usage.outputTokens ?? 0,
      totalTokens: result.usage.totalTokens ?? 0,
    },
  };
}
