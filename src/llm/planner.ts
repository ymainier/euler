import { generateText, Output } from "ai";
import type { ModelMessage } from "ai";
import {
  TaskPlanSchema,
  type TaskPlan,
  type TokenUsage,
  type RoleConfig,
} from "../types.ts";

export type ToolDescriptor = { name: string; description: string };

export async function plan(args: {
  goal: string;
  messages: ModelMessage[];
  feedback: string | null;
  config: RoleConfig;
  availableTools: ToolDescriptor[];
  timeoutMs: number;
}): Promise<{ plan: TaskPlan; usage: TokenUsage }> {
  const { goal, messages, feedback, config, availableTools, timeoutMs } = args;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Task timed out after ${timeoutMs}ms`)),
      timeoutMs,
    ),
  );

  const toolsSection =
    availableTools.length > 0
      ? `\n\nAvailable tools (use only these exact names in task tool lists):\n${availableTools.map((t) => `- ${t.name}: ${t.description}`).join("\n")}`
      : "\n\nNo tools are available. Set tools to [] for all tasks.";

  const basePrompt = `${config.systemPrompt}${toolsSection}`;
  const systemPrompt = feedback
    ? `${basePrompt}\n\nPrevious attempt feedback:\n${feedback}`
    : basePrompt;

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
