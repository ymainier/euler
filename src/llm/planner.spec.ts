import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { plan } from "./planner.ts";

const samplePlan = {
  reasoning: "step by step",
  tasks: [
    { taskId: "t1", description: "do something", tools: [], dependsOn: [] },
  ],
  canParallelize: false,
  maxConcurrency: 1,
};

const makeModel = (
  overrides?: Partial<ConstructorParameters<typeof MockLanguageModelV3>[0]>,
) =>
  new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(samplePlan) }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: {
        inputTokens: {
          total: 10,
          noCache: 10,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    }),
    ...overrides,
  });

describe("plan", () => {
  it("returns a validated TaskPlan from mocked LanguageModel", async () => {
    const result = await plan({
      goal: "summarise the docs",
      messages: [],
      feedback: null,
      config: { model: makeModel(), systemPrompt: "You are a planner." },
      availableTools: [],
      timeoutMs: 5000,
    });

    expect(result.plan).toEqual(samplePlan);
  });

  it("includes available tools with descriptions in the system prompt", async () => {
    const model = makeModel();
    await plan({
      goal: "do something",
      messages: [],
      feedback: null,
      config: { model, systemPrompt: "You are a planner." },
      availableTools: [
        { name: "search", description: "Find information on the web" },
        { name: "calculator", description: "Evaluate math expressions" },
      ],
      timeoutMs: 5000,
    });

    const systemMessage = model.doGenerateCalls[0]?.prompt.find(
      (m) => m.role === "system",
    );
    expect(systemMessage?.content).toContain(
      "- search: Find information on the web",
    );
    expect(systemMessage?.content).toContain(
      "- calculator: Evaluate math expressions",
    );
  });

  it("includes feedback in the prompt when provided", async () => {
    const model = makeModel();
    await plan({
      goal: "summarise the docs",
      messages: [],
      feedback: "task t1 had a dangling reference",
      config: { model, systemPrompt: "You are a planner." },
      availableTools: [],
      timeoutMs: 5000,
    });

    const systemMessage = model.doGenerateCalls[0]?.prompt.find(
      (m) => m.role === "system",
    );
    expect(systemMessage?.content).toContain(
      "task t1 had a dangling reference",
    );
  });

  it("extracts token usage from the SDK response", async () => {
    const result = await plan({
      goal: "summarise the docs",
      messages: [],
      feedback: null,
      config: { model: makeModel(), systemPrompt: "You are a planner." },
      availableTools: [],
      timeoutMs: 5000,
    });

    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
  });

  it("rejects when the timeout expires", async () => {
    const slowModel = new MockLanguageModelV3({
      doGenerate: () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                content: [
                  { type: "text" as const, text: JSON.stringify(samplePlan) },
                ],
                finishReason: { unified: "stop" as const, raw: "stop" },
                usage: {
                  inputTokens: {
                    total: 10,
                    noCache: 10,
                    cacheRead: undefined,
                    cacheWrite: undefined,
                  },
                  outputTokens: { total: 20, text: 20, reasoning: undefined },
                },
                warnings: [],
              }),
            200,
          ),
        ),
    });

    await expect(
      plan({
        goal: "summarise the docs",
        messages: [],
        feedback: null,
        config: { model: slowModel, systemPrompt: "You are a planner." },
        availableTools: [],
        timeoutMs: 10,
      }),
    ).rejects.toThrow("Task timed out after 10ms");
  });
});
