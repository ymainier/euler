import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ToolExecutionOptions } from "ai";
import { createWriteFileTool, type WriteFileResult } from "./writeFile.ts";

const execOpts: ToolExecutionOptions = { toolCallId: "t", messages: [] };

function makeExecute(dir: string) {
  const t = createWriteFileTool({ workingDirectory: dir });
  return (args: Parameters<NonNullable<typeof t.execute>>[0]) =>
    t.execute!(args, execOpts) as Promise<WriteFileResult>;
}

describe("createWriteFileTool", () => {
  let dir: string;
  let execute: ReturnType<typeof makeExecute>;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "euler-test-"));
    execute = makeExecute(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it("creates a new file", async () => {
    const result = await execute({ path: "new.txt", content: "hello\n" });
    expect(result).toMatchObject({
      ok: true,
      value: { path: "new.txt", bytesWritten: 6 },
    });
    expect(readFileSync(path.join(dir, "new.txt"), "utf-8")).toBe("hello\n");
  });

  it("overwrites an existing file", async () => {
    writeFileSync(path.join(dir, "existing.txt"), "old content");
    const result = await execute({
      path: "existing.txt",
      content: "new content",
    });
    expect(result).toMatchObject({ ok: true });
    expect(readFileSync(path.join(dir, "existing.txt"), "utf-8")).toBe(
      "new content",
    );
  });

  it("creates nested directories", async () => {
    const result = await execute({ path: "a/b/c/deep.txt", content: "deep" });
    expect(result).toMatchObject({ ok: true });
    expect(
      readFileSync(path.join(dir, "a", "b", "c", "deep.txt"), "utf-8"),
    ).toBe("deep");
  });

  it("throws for path escape", async () => {
    await expect(
      execute({ path: "../escape.txt", content: "bad" }),
    ).rejects.toThrow("path escapes working directory");
  });

  it("leaves no .tmp file after successful write", async () => {
    await execute({ path: "clean.txt", content: "ok" });
    expect(existsSync(path.join(dir, "clean.txt.tmp"))).toBe(false);
  });
});
