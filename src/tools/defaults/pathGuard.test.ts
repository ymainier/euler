import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveWithinRoot } from "./pathGuard.ts";

describe("resolveWithinRoot", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "euler-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it("resolves a simple relative path within root", () => {
    const result = resolveWithinRoot(dir, "foo.txt");
    expect(result).toBe(path.join(dir, "foo.txt"));
  });

  it("resolves a nested path within root", () => {
    const result = resolveWithinRoot(dir, "a/b/c.ts");
    expect(result).toBe(path.join(dir, "a", "b", "c.ts"));
  });

  it("resolves dot path to root itself", () => {
    const result = resolveWithinRoot(dir, ".");
    expect(result).toBe(dir);
  });

  it("throws for .. escape at top level", () => {
    expect(() => resolveWithinRoot(dir, "../outside.txt")).toThrow(
      "path escapes working directory",
    );
  });

  it("throws for .. escape through subdirectory", () => {
    expect(() => resolveWithinRoot(dir, "sub/../../outside.txt")).toThrow(
      "path escapes working directory",
    );
  });

  it("throws for absolute path outside root", () => {
    expect(() => resolveWithinRoot(dir, "/etc/passwd")).toThrow(
      "path escapes working directory",
    );
  });

  it("allows a path through a symlink pointing inside root", () => {
    const inner = path.join(dir, "inner");
    mkdirSync(inner);
    const linkPath = path.join(dir, "link-to-inner");
    symlinkSync(inner, linkPath);
    const result = resolveWithinRoot(dir, "link-to-inner/foo.txt");
    expect(result).toBe(path.join(dir, "link-to-inner", "foo.txt"));
  });

  it("throws for symlink pointing directly outside root", () => {
    let outside: string | undefined;
    try {
      outside = mkdtempSync(path.join(tmpdir(), "euler-outside-"));
      const evilLink = path.join(dir, "evil-link");
      symlinkSync(outside, evilLink);
      expect(() => resolveWithinRoot(dir, "evil-link")).toThrow(
        "path escapes working directory",
      );
    } finally {
      if (outside) rmSync(outside, { recursive: true });
    }
  });

  it("throws for path through a symlink leading to a file outside root", () => {
    let outside: string | undefined;
    try {
      outside = mkdtempSync(path.join(tmpdir(), "euler-outside-"));
      writeFileSync(path.join(outside, "secret.txt"), "secret");
      const evilDir = path.join(dir, "evil-dir");
      symlinkSync(outside, evilDir);
      expect(() => resolveWithinRoot(dir, "evil-dir/secret.txt")).toThrow(
        "path escapes working directory",
      );
    } finally {
      if (outside) rmSync(outside, { recursive: true });
    }
  });
});
