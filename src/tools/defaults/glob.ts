import { tool } from "ai";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "./pathGuard.ts";

const MAX_PATHS = 500;
const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist"]);

const globSchema = z.object({
  pattern: z
    .string()
    .describe("Glob pattern, e.g. '**/*.ts' or 'src/**/*.test.ts'"),
  path: z
    .string()
    .optional()
    .describe("Base directory relative to working dir; defaults to root"),
});

export type GlobResult =
  | { ok: true; value: { paths: string[]; truncated: boolean } }
  | { ok: false; error: string };

async function walkGlob(
  dir: string,
  pattern: string,
  root: string,
  results: Array<{ path: string; mtime: number }>,
): Promise<void> {
  if (results.length >= MAX_PATHS) return;

  const entries = await fs
    .readdir(dir, { withFileTypes: true })
    .catch(() => null);
  if (!entries) return;

  for (const entry of entries) {
    if (results.length >= MAX_PATHS) break;
    if (EXCLUDED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(root, fullPath);

    if (entry.isDirectory()) {
      await walkGlob(fullPath, pattern, root, results);
    } else if (entry.isFile()) {
      if (path.matchesGlob(relPath, pattern)) {
        let mtime = 0;
        try {
          const stat = await fs.stat(fullPath);
          mtime = stat.mtimeMs;
        } catch {
          // use 0 if stat fails
        }
        results.push({ path: relPath, mtime });
      }
    }
  }
}

export function createGlobTool(opts: { workingDirectory: string }) {
  return tool({
    description:
      "Find files matching a glob pattern relative to the working directory. Results sorted by modification time (newest first). Excludes node_modules, .git, dist.",
    inputSchema: globSchema,
    execute: async (args): Promise<GlobResult> => {
      const basePath = args.path
        ? resolveWithinRoot(opts.workingDirectory, args.path)
        : opts.workingDirectory;

      const results: Array<{ path: string; mtime: number }> = [];
      try {
        await walkGlob(basePath, args.pattern, opts.workingDirectory, results);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      results.sort((a, b) => b.mtime - a.mtime);
      const truncated = results.length >= MAX_PATHS;
      const paths = results.slice(0, MAX_PATHS).map((r) => r.path);

      return { ok: true, value: { paths, truncated } };
    },
  });
}
