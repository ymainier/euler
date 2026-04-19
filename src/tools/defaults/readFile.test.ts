import { afterEach, assert, beforeEach, describe, expect, it } from "vitest";
import {
  closeSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ToolExecutionOptions } from "ai";
import { createReadFileTool, type ReadFileResult } from "./readFile.ts";

const execOpts: ToolExecutionOptions = { toolCallId: "t", messages: [] };

function makeExecute(dir: string) {
  const t = createReadFileTool({ workingDirectory: dir });
  return (args: Parameters<NonNullable<typeof t.execute>>[0]) =>
    t.execute!(args, execOpts) as Promise<ReadFileResult>;
}

describe("createReadFileTool", () => {
  let dir: string;
  let execute: ReturnType<typeof makeExecute>;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "euler-test-"));
    execute = makeExecute(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it("reads a small file with 1-indexed line numbers", async () => {
    writeFileSync(path.join(dir, "hello.txt"), "alpha\nbeta\ngamma\n");
    const result = await execute({ path: "hello.txt" });
    expect(result).toMatchObject({
      ok: true,
      value: { totalLines: 3, truncated: false },
    });
    assert(result.ok);
    expect(result.value.content).toContain("     1\talpha");
    expect(result.value.content).toContain("     2\tbeta");
    expect(result.value.content).toContain("     3\tgamma");
  });

  it("applies offsetLines and limitLines", async () => {
    writeFileSync(path.join(dir, "nums.txt"), "one\ntwo\nthree\nfour\nfive\n");
    const result = await execute({
      path: "nums.txt",
      offsetLines: 2,
      limitLines: 2,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { totalLines: 5, truncated: true },
    });
    assert(result.ok);
    expect(result.value.content).toContain("     2\ttwo");
    expect(result.value.content).toContain("     3\tthree");
    expect(result.value.content).not.toContain("one");
    expect(result.value.content).not.toContain("four");
  });

  it("returns structured error for missing file", async () => {
    const result = await execute({ path: "nope.txt" });
    expect(result).toMatchObject({ ok: false });
    assert(!result.ok);
    expect(result.error).toMatch(/ENOENT/);
  });

  it("returns structured error for binary file", async () => {
    const fd = openSync(path.join(dir, "img.bin"), "w");
    writeSync(fd, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a]));
    closeSync(fd);
    const result = await execute({ path: "img.bin" });
    expect(result).toMatchObject({ ok: false, error: "binary file" });
  });

  it("throws for path escape", async () => {
    await expect(execute({ path: "../outside.txt" })).rejects.toThrow(
      "path escapes working directory",
    );
  });

  it("reads exactly 2000 lines without truncation", async () => {
    const content =
      Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    writeFileSync(path.join(dir, "big.txt"), content);
    const result = await execute({ path: "big.txt" });
    expect(result).toMatchObject({
      ok: true,
      value: { totalLines: 2000, truncated: false },
    });
  });

  it("truncates files exceeding 2000 lines", async () => {
    const content =
      Array.from({ length: 2001 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    writeFileSync(path.join(dir, "huge.txt"), content);
    const result = await execute({ path: "huge.txt" });
    expect(result).toMatchObject({
      ok: true,
      value: { totalLines: 2001, truncated: true },
    });
    assert(result.ok);
    expect(result.value.content).toContain("lines omitted");
  });
});
