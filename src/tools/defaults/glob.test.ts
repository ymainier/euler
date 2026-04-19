import { afterEach, assert, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ToolExecutionOptions } from "ai";
import { createGlobTool, type GlobResult } from "./glob.ts";

const execOpts: ToolExecutionOptions = { toolCallId: "t", messages: [] };

function makeExecute(dir: string) {
  const t = createGlobTool({ workingDirectory: dir });
  return (args: Parameters<NonNullable<typeof t.execute>>[0]) =>
    t.execute!(args, execOpts) as Promise<GlobResult>;
}

describe("createGlobTool", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "euler-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it("finds all .ts files with **/*.ts", async () => {
    writeFileSync(path.join(dir, "a.ts"), "");
    mkdirSync(path.join(dir, "src"));
    writeFileSync(path.join(dir, "src", "b.ts"), "");
    writeFileSync(path.join(dir, "src", "c.js"), "");
    const result = await makeExecute(dir)({ pattern: "**/*.ts" });
    expect(result).toMatchObject({ ok: true });
    assert(result.ok);
    expect(result.value.paths.some((p) => p.endsWith("a.ts"))).toBe(true);
    expect(result.value.paths.some((p) => p.includes("b.ts"))).toBe(true);
    expect(result.value.paths.every((p) => !p.endsWith(".js"))).toBe(true);
  });

  it("narrows search with base path option", async () => {
    writeFileSync(path.join(dir, "root.ts"), "");
    mkdirSync(path.join(dir, "sub"));
    writeFileSync(path.join(dir, "sub", "sub.ts"), "");
    const result = await makeExecute(dir)({ pattern: "**/*.ts", path: "sub" });
    expect(result).toMatchObject({ ok: true });
    assert(result.ok);
    expect(result.value.paths.every((p) => p.includes("sub"))).toBe(true);
    expect(result.value.paths.every((p) => !p.includes("root.ts"))).toBe(true);
  });

  it("excludes node_modules by default", async () => {
    mkdirSync(path.join(dir, "node_modules"));
    writeFileSync(path.join(dir, "node_modules", "pkg.ts"), "");
    writeFileSync(path.join(dir, "real.ts"), "");
    const result = await makeExecute(dir)({ pattern: "**/*.ts" });
    expect(result).toMatchObject({ ok: true });
    assert(result.ok);
    expect(result.value.paths.every((p) => !p.includes("node_modules"))).toBe(
      true,
    );
    expect(result.value.paths.some((p) => p.includes("real.ts"))).toBe(true);
  });

  it("truncates at 500 paths", async () => {
    for (let i = 0; i < 510; i++) {
      writeFileSync(path.join(dir, `file${i}.ts`), "");
    }
    const result = await makeExecute(dir)({ pattern: "**/*.ts" });
    expect(result).toMatchObject({ ok: true });
    assert(result.ok);
    expect(result.value.paths.length).toBe(500);
    expect(result.value.truncated).toBe(true);
  });

  it("sorts results by mtime descending", async () => {
    const older = path.join(dir, "older.ts");
    const newer = path.join(dir, "newer.ts");
    writeFileSync(older, "");
    writeFileSync(newer, "");
    // Use timestamps well within 32-bit safe zone to avoid filesystem clamping
    utimesSync(older, new Date(1_000_000_000_000), new Date(1_000_000_000_000)); // Sept 2001
    utimesSync(newer, new Date(1_700_000_000_000), new Date(1_700_000_000_000)); // Nov 2023

    const result = await makeExecute(dir)({ pattern: "**/*.ts" });
    expect(result).toMatchObject({ ok: true });
    assert(result.ok);
    const newerIdx = result.value.paths.findIndex((p) =>
      p.includes("newer.ts"),
    );
    const olderIdx = result.value.paths.findIndex((p) =>
      p.includes("older.ts"),
    );
    expect(newerIdx).toBeLessThan(olderIdx);
  });

  it("throws for path escape", async () => {
    await expect(
      makeExecute(dir)({ pattern: "**/*.ts", path: "../outside" }),
    ).rejects.toThrow("path escapes working directory");
  });
});
