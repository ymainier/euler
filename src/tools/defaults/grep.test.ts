import { afterEach, assert, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ToolExecutionOptions } from "ai";
import {
  createGrepTool,
  resetRgAvailableCache,
  type GrepResult,
} from "./grep.ts";

const execOpts: ToolExecutionOptions = { toolCallId: "t", messages: [] };

// Zod .default() makes caseInsensitive and contextLines required in z.infer — use a looser input type
type GrepInput = {
  pattern: string;
  path?: string;
  include?: string;
  caseInsensitive?: boolean;
  contextLines?: number;
};

function makeExecute(dir: string) {
  const t = createGrepTool({ workingDirectory: dir });
  return (args: GrepInput) =>
    t.execute!(
      args as Parameters<NonNullable<typeof t.execute>>[0],
      execOpts,
    ) as Promise<GrepResult>;
}

describe("createGrepTool", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "euler-test-"));
    resetRgAvailableCache();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it("finds matches in a file", async () => {
    writeFileSync(path.join(dir, "a.ts"), "const x = 1;\nconst y = 2;\n");
    const result = await makeExecute(dir)({ pattern: "const" });
    expect(result).toMatchObject({ ok: true });
    assert(result.ok);
    expect(result.value.matches.length).toBe(2);
    expect(result.value.matches[0]).toMatchObject({ lineNumber: 1 });
  });

  it("respects include glob", async () => {
    writeFileSync(path.join(dir, "a.ts"), "needle");
    writeFileSync(path.join(dir, "b.js"), "needle");
    const result = await makeExecute(dir)({
      pattern: "needle",
      include: "*.ts",
    });
    expect(result).toMatchObject({ ok: true });
    assert(result.ok);
    expect(result.value.matches.every((m) => m.file.endsWith(".ts"))).toBe(
      true,
    );
  });

  it("is case insensitive when requested", async () => {
    writeFileSync(path.join(dir, "c.txt"), "Hello World\nhello world\n");
    const result = await makeExecute(dir)({
      pattern: "HELLO",
      caseInsensitive: true,
    });
    expect(result).toMatchObject({ ok: true });
    assert(result.ok);
    expect(result.value.matches.length).toBe(2);
  });

  it("returns context lines", async () => {
    writeFileSync(path.join(dir, "ctx.txt"), "before\nmatch\nafter\n");
    const result = await makeExecute(dir)({
      pattern: "match",
      contextLines: 1,
    });
    expect(result).toMatchObject({ ok: true });
    assert(result.ok);
    const m = result.value.matches[0];
    expect(m?.contextBefore).toContain("before");
    expect(m?.contextAfter).toContain("after");
  });

  it("returns structured error for invalid regex", async () => {
    const result = await makeExecute(dir)({ pattern: "[invalid" });
    expect(result).toMatchObject({ ok: false });
    assert(!result.ok);
    expect(result.error).toMatch(/invalid regex/);
  });

  it("throws for path escape", async () => {
    await expect(
      makeExecute(dir)({ pattern: "x", path: "../outside" }),
    ).rejects.toThrow("path escapes working directory");
  });

  it("truncates at 200 matches", async () => {
    const lines = Array.from({ length: 210 }, (_, i) => `match line ${i}`).join(
      "\n",
    );
    writeFileSync(path.join(dir, "many.txt"), lines);
    const result = await makeExecute(dir)({ pattern: "match" });
    expect(result).toMatchObject({ ok: true });
    assert(result.ok);
    expect(result.value.matches.length).toBe(200);
    expect(result.value.truncated).toBe(true);
  });

  it("searches in a specified sub-path", async () => {
    const sub = path.join(dir, "sub");
    mkdirSync(sub);
    writeFileSync(path.join(dir, "root.txt"), "needle");
    writeFileSync(path.join(sub, "sub.txt"), "needle");
    const result = await makeExecute(dir)({ pattern: "needle", path: "sub" });
    expect(result).toMatchObject({ ok: true });
    assert(result.ok);
    const files = result.value.matches.map((m) => m.file);
    expect(files.some((f) => f.includes("sub.txt"))).toBe(true);
    expect(files.every((f) => !f.includes("root.txt"))).toBe(true);
  });

  it("uses JS fallback when rg is unavailable", async () => {
    resetRgAvailableCache(false); // force JS fallback path
    writeFileSync(path.join(dir, "fallback.txt"), "fallback needle\n");
    const result = await makeExecute(dir)({ pattern: "needle" });
    expect(result).toMatchObject({ ok: true });
    assert(result.ok);
    expect(result.value.matches.length).toBeGreaterThan(0);
  });
});
