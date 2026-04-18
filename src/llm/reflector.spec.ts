import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { reflect } from "./reflector.ts";

const base = {
  answer: "",
  feedback: "",
  skippedTasks: [],
  partialAnswer: "",
};

const makeModel = (response: object) =>
  new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(response) }],
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
  });

describe("reflect", () => {
  it("parses a 'done' decision correctly", async () => {
    const model = makeModel({
      ...base,
      decision: "done",
      answer: "42",
      reasoning: "because",
      confidence: { score: 0.9, reasoning: "strong signal" },
    });

    const result = await reflect({
      goal: "answer the question",
      tasks: {},
      messages: [],
      config: { model, systemPrompt: "You are a reflector." },
      timeoutMs: 5000,
    });

    expect(result.output).toEqual({
      ...base,
      decision: "done",
      answer: "42",
      reasoning: "because",
      confidence: { score: 0.9, reasoning: "strong signal" },
    });
  });

  it("parses a 'replan' decision correctly", async () => {
    const model = makeModel({
      ...base,
      decision: "replan",
      reasoning: "t1 failed",
      feedback: "retry with different approach",
      skippedTasks: ["t2", "t3"],
      confidence: { score: 0.6, reasoning: "uncertain" },
    });

    const result = await reflect({
      goal: "answer the question",
      tasks: {},
      messages: [],
      config: { model, systemPrompt: "You are a reflector." },
      timeoutMs: 5000,
    });

    expect(result.output).toEqual({
      ...base,
      decision: "replan",
      reasoning: "t1 failed",
      feedback: "retry with different approach",
      skippedTasks: ["t2", "t3"],
      confidence: { score: 0.6, reasoning: "uncertain" },
    });
  });

  it("parses an 'escalate' decision correctly", async () => {
    const model = makeModel({
      ...base,
      decision: "escalate",
      reasoning: "beyond scope",
      partialAnswer: "I found some clues",
      confidence: { score: 0.3, reasoning: "low confidence" },
    });

    const result = await reflect({
      goal: "answer the question",
      tasks: {},
      messages: [],
      config: { model, systemPrompt: "You are a reflector." },
      timeoutMs: 5000,
    });

    expect(result.output).toEqual({
      ...base,
      decision: "escalate",
      reasoning: "beyond scope",
      partialAnswer: "I found some clues",
      confidence: { score: 0.3, reasoning: "low confidence" },
    });
  });

  it("extracts token usage from the SDK response", async () => {
    const model = makeModel({
      ...base,
      decision: "done",
      answer: "42",
      reasoning: "because",
      confidence: { score: 0.9, reasoning: "strong signal" },
    });

    const result = await reflect({
      goal: "answer the question",
      tasks: {},
      messages: [],
      config: { model, systemPrompt: "You are a reflector." },
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
                  {
                    type: "text" as const,
                    text: JSON.stringify({
                      ...base,
                      decision: "done",
                      answer: "42",
                      reasoning: "because",
                      confidence: { score: 0.9, reasoning: "strong" },
                    }),
                  },
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
      reflect({
        goal: "answer the question",
        tasks: {},
        messages: [],
        config: { model: slowModel, systemPrompt: "You are a reflector." },
        timeoutMs: 10,
      }),
    ).rejects.toThrow("Task timed out after 10ms");
  });
});
