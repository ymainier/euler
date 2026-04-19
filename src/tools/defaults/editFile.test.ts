import { afterEach, assert, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ToolExecutionOptions } from "ai";
import { createEditFileTool, type EditFileResult } from "./editFile.ts";

const execOpts: ToolExecutionOptions = { toolCallId: "t", messages: [] };

function makeExecute(dir: string) {
  const t = createEditFileTool({ workingDirectory: dir });
  return (args: Parameters<NonNullable<typeof t.execute>>[0]) =>
    t.execute!(args, execOpts) as Promise<EditFileResult>;
}

describe("createEditFileTool", () => {
  let dir: string;
  let execute: ReturnType<typeof makeExecute>;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "euler-test-"));
    execute = makeExecute(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it("replaces a unique match", async () => {
    writeFileSync(path.join(dir, "src.ts"), "const x = 1;\nconst y = 2;\n");
    const result = await execute({
      path: "src.ts",
      oldString: "const x = 1;",
      newString: "const x = 99;",
    });
    expect(result).toMatchObject({ ok: true });
    expect(readFileSync(path.join(dir, "src.ts"), "utf-8")).toBe(
      "const x = 99;\nconst y = 2;\n",
    );
  });

  it("returns structured error when oldString is not found", async () => {
    writeFileSync(path.join(dir, "f.txt"), "hello world");
    const result = await execute({
      path: "f.txt",
      oldString: "missing",
      newString: "x",
    });
    expect(result).toMatchObject({
      ok: false,
      error: "oldString not found in file",
    });
  });

  it("returns structured error when oldString matches multiple times", async () => {
    writeFileSync(path.join(dir, "dup.txt"), "foo foo foo");
    const result = await execute({
      path: "dup.txt",
      oldString: "foo",
      newString: "bar",
    });
    expect(result).toMatchObject({ ok: false });
    assert(!result.ok);
    expect(result.error).toMatch(/matches 3 times/);
  });

  it("deletes text when newString is empty", async () => {
    writeFileSync(path.join(dir, "del.txt"), "keep this remove this keep");
    const result = await execute({
      path: "del.txt",
      oldString: " remove this",
      newString: "",
    });
    expect(result).toMatchObject({ ok: true });
    expect(readFileSync(path.join(dir, "del.txt"), "utf-8")).toBe(
      "keep this keep",
    );
  });

  it("throws for path escape", async () => {
    await expect(
      execute({ path: "../escape.ts", oldString: "x", newString: "y" }),
    ).rejects.toThrow("path escapes working directory");
  });

  it("returns structured error for missing file", async () => {
    const result = await execute({
      path: "ghost.txt",
      oldString: "x",
      newString: "y",
    });
    expect(result).toMatchObject({ ok: false });
    assert(!result.ok);
    expect(result.error).toMatch(/ENOENT/);
  });
});
