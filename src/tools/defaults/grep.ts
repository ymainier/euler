import { tool } from "ai";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveWithinRoot } from "./pathGuard.ts";

const execFileAsync = promisify(execFile);

const MAX_MATCHES = 200;
const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist"]);

const grepSchema = z.object({
  pattern: z.string().describe("Regex pattern to search for"),
  path: z
    .string()
    .optional()
    .describe(
      "Directory to search in, relative to working dir; defaults to root",
    ),
  include: z
    .string()
    .optional()
    .describe("Glob filter for files to include, e.g. '*.ts'"),
  caseInsensitive: z.boolean().optional().default(false),
  contextLines: z.number().int().min(0).max(5).optional().default(0),
});

export type MatchResult = {
  file: string;
  lineNumber: number;
  line: string;
  contextBefore: string[];
  contextAfter: string[];
};

export type GrepResult =
  | { ok: true; value: { matches: MatchResult[]; truncated: boolean } }
  | { ok: false; error: string };

// Cached rg availability check
let _rgAvailable: boolean | null = null;
export async function isRgAvailable(): Promise<boolean> {
  if (_rgAvailable !== null) return _rgAvailable;
  try {
    await execFileAsync("rg", ["--version"]);
    _rgAvailable = true;
  } catch {
    _rgAvailable = false;
  }
  return _rgAvailable;
}

// Exposed for testing — pass false to force JS fallback, null (default) to re-check on next call
export function resetRgAvailableCache(value: boolean | null = null): void {
  _rgAvailable = value;
}

type RgEvent =
  | { type: "begin"; data: { path: { text: string } } }
  | {
      type: "match";
      data: {
        path: { text: string };
        lines: { text: string };
        line_number: number;
      };
    }
  | {
      type: "context";
      data: {
        path: { text: string };
        lines: { text: string };
        line_number: number;
      };
    }
  | { type: "end" | "summary"; data: unknown };

function parseRgOutput(stdout: string, contextLines: number): MatchResult[] {
  const results: MatchResult[] = [];
  let beforeBuffer: string[] = [];
  let lastMatch: MatchResult | null = null;
  let afterRemaining = 0;

  for (const raw of stdout.split("\n")) {
    if (!raw.trim()) continue;
    let event: RgEvent;
    try {
      event = JSON.parse(raw) as RgEvent;
    } catch {
      continue;
    }

    if (event.type === "begin") {
      beforeBuffer = [];
      lastMatch = null;
      afterRemaining = 0;
    } else if (event.type === "context") {
      const line = event.data.lines.text.trimEnd();
      if (afterRemaining > 0 && lastMatch !== null) {
        lastMatch.contextAfter.push(line);
        afterRemaining--;
        if (afterRemaining === 0) lastMatch = null;
      }
      beforeBuffer.push(line);
      if (beforeBuffer.length > contextLines) beforeBuffer.shift();
    } else if (event.type === "match") {
      if (results.length >= MAX_MATCHES) continue;
      const match: MatchResult = {
        file: event.data.path.text,
        lineNumber: event.data.line_number,
        line: event.data.lines.text.trimEnd(),
        contextBefore: [...beforeBuffer],
        contextAfter: [],
      };
      results.push(match);
      lastMatch = match;
      beforeBuffer = [];
      afterRemaining = contextLines;
    } else if (event.type === "end") {
      lastMatch = null;
      afterRemaining = 0;
      beforeBuffer = [];
    }
  }

  return results;
}

async function grepWithRg(
  searchPath: string,
  pattern: string,
  include: string | undefined,
  caseInsensitive: boolean,
  contextLines: number,
  workingDirectory: string,
): Promise<MatchResult[]> {
  const args = ["--json", "--no-heading"];
  if (caseInsensitive) args.push("--ignore-case");
  if (contextLines > 0) args.push("-C", String(contextLines));
  if (include) args.push("--glob", include);
  args.push(pattern, searchPath);

  let stdout: string;
  try {
    const result = await execFileAsync("rg", args, {
      cwd: workingDirectory,
      maxBuffer: 10 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (err: unknown) {
    // rg exits 1 when no matches found — that's ok, not an error
    const child = err as { code?: number; stdout?: string };
    if (child.code === 1) return [];
    throw err;
  }

  return parseRgOutput(stdout, contextLines);
}

async function grepFile(
  filePath: string,
  relPath: string,
  regex: RegExp,
  contextLines: number,
  results: MatchResult[],
): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return;
  }
  if (content.includes("\0")) return;

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (results.length >= MAX_MATCHES) return;
    if (regex.test(lines[i] ?? "")) {
      results.push({
        file: relPath,
        lineNumber: i + 1,
        line: lines[i] ?? "",
        contextBefore: lines.slice(Math.max(0, i - contextLines), i),
        contextAfter: lines.slice(i + 1, i + 1 + contextLines),
      });
    }
  }
}

async function walkAndGrep(
  dir: string,
  regex: RegExp,
  include: string | undefined,
  contextLines: number,
  results: MatchResult[],
  root: string,
): Promise<void> {
  if (results.length >= MAX_MATCHES) return;

  const entries = await fs
    .readdir(dir, { withFileTypes: true })
    .catch(() => null);
  if (!entries) return;

  for (const entry of entries) {
    if (results.length >= MAX_MATCHES) break;
    if (EXCLUDED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(root, fullPath);

    if (entry.isDirectory()) {
      await walkAndGrep(fullPath, regex, include, contextLines, results, root);
    } else if (entry.isFile()) {
      if (include !== undefined && !path.matchesGlob(relPath, include))
        continue;
      await grepFile(fullPath, relPath, regex, contextLines, results);
    }
  }
}

async function grepFallback(
  searchPath: string,
  pattern: string,
  include: string | undefined,
  caseInsensitive: boolean,
  contextLines: number,
  root: string,
): Promise<MatchResult[]> {
  const results: MatchResult[] = [];
  const regex = new RegExp(pattern, caseInsensitive ? "i" : "");
  await walkAndGrep(searchPath, regex, include, contextLines, results, root);
  return results;
}

export function createGrepTool(opts: { workingDirectory: string }) {
  return tool({
    description:
      "Search file contents for a regex pattern. Returns matching lines with file path and line number. Supports context lines and glob file filters.",
    inputSchema: grepSchema,
    execute: async (args): Promise<GrepResult> => {
      let regex: RegExp;
      try {
        regex = new RegExp(args.pattern, args.caseInsensitive ? "i" : "");
        void regex;
      } catch {
        return { ok: false, error: `invalid regex: ${args.pattern}` };
      }

      const searchPath = args.path
        ? resolveWithinRoot(opts.workingDirectory, args.path)
        : opts.workingDirectory;

      let matches: MatchResult[];
      if (await isRgAvailable()) {
        try {
          matches = await grepWithRg(
            searchPath,
            args.pattern,
            args.include,
            args.caseInsensitive ?? false,
            args.contextLines ?? 0,
            opts.workingDirectory,
          );
        } catch {
          matches = await grepFallback(
            searchPath,
            args.pattern,
            args.include,
            args.caseInsensitive ?? false,
            args.contextLines ?? 0,
            opts.workingDirectory,
          );
        }
      } else {
        matches = await grepFallback(
          searchPath,
          args.pattern,
          args.include,
          args.caseInsensitive ?? false,
          args.contextLines ?? 0,
          opts.workingDirectory,
        );
      }

      const truncated = matches.length >= MAX_MATCHES;
      return {
        ok: true,
        value: { matches: matches.slice(0, MAX_MATCHES), truncated },
      };
    },
  });
}
