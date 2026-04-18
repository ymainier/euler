import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { tool } from "ai";
import { z } from "zod";
import { executeTask } from "./executor.ts";

const makeTask = (overrides?: object) => ({
  taskId: "t1",
  description: "do something",
  tools: [],
  dependsOn: [],
  ...overrides,
});

const makeModel = (
  overrides?: Partial<ConstructorParameters<typeof MockLanguageModelV3>[0]>,
) =>
  new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: "task result" }],
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

const makeToolCallContent = (toolName: string, input: object) => ({
  type: "tool-call" as const,
  toolCallId: `tc-${toolName}`,
  toolName,
  input: JSON.stringify(input),
});

const makeSearchTool = () =>
  tool({
    description: "search",
    inputSchema: z.object({ query: z.string() }),
    execute: async (_input: { query: string }) => "results",
  });

describe("executeTask", () => {
  it("returns a TaskOutput with taskId, result text, and empty toolsUsed", async () => {
    const result = await executeTask({
      task: makeTask(),
      tools: {},
      config: { model: makeModel(), systemPrompt: "You are an executor." },
      maxSteps: 5,
      timeoutMs: 5000,
    });

    expect(result.output).toEqual({
      taskId: "t1",
      result: "task result",
      toolsUsed: [],
    });
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
  });

  it("output includes toolsUsed when tools are called", async () => {
    let callCount = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        callCount++;
        if (callCount === 1) {
          return {
            content: [makeToolCallContent("search", { query: "foo" })],
            finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
            usage: {
              inputTokens: {
                total: 5,
                noCache: 5,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: 5, text: 5, reasoning: undefined },
            },
            warnings: [],
          };
        }
        return {
          content: [{ type: "text" as const, text: "done" }],
          finishReason: { unified: "stop" as const, raw: "stop" },
          usage: {
            inputTokens: {
              total: 5,
              noCache: 5,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 5, text: 5, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });

    const result = await executeTask({
      task: makeTask({ tools: ["search"] }),
      tools: { search: makeSearchTool() },
      config: { model, systemPrompt: "You are an executor." },
      maxSteps: 5,
      timeoutMs: 5000,
    });

    expect(result.output.toolsUsed).toEqual(["search"]);
  });

  it("passes the tool subset through to generateText", async () => {
    const model = makeModel();

    await executeTask({
      task: makeTask({ tools: ["search"] }),
      tools: { search: makeSearchTool() },
      config: { model, systemPrompt: "You are an executor." },
      maxSteps: 5,
      timeoutMs: 5000,
    });

    const passedTools = model.doGenerateCalls[0]?.tools;
    expect(passedTools?.map((t) => t.name)).toEqual(["search"]);
  });

  it("respects maxSteps", async () => {
    // Model always returns a tool call — SDK should stop after maxSteps calls
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [makeToolCallContent("search", { query: "foo" })],
        finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
        usage: {
          inputTokens: {
            total: 5,
            noCache: 5,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      }),
    });

    await executeTask({
      task: makeTask({ tools: ["search"] }),
      tools: { search: makeSearchTool() },
      config: { model, systemPrompt: "You are an executor." },
      maxSteps: 2,
      timeoutMs: 5000,
    });

    expect(model.doGenerateCalls.length).toBe(2);
  });

  it("rejects when the timeout expires", async () => {
    const slowModel = new MockLanguageModelV3({
      doGenerate: () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                content: [{ type: "text" as const, text: "done" }],
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
      executeTask({
        task: makeTask(),
        tools: {},
        config: { model: slowModel, systemPrompt: "You are an executor." },
        maxSteps: 5,
        timeoutMs: 10,
      }),
    ).rejects.toThrow("Task timed out after 10ms");
  });
});
