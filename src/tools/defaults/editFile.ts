import { tool } from "ai";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "./pathGuard.ts";

const editFileSchema = z.object({
  path: z.string().describe("Path relative to the working directory"),
  oldString: z
    .string()
    .describe("Exact text to find; must match exactly once in the file"),
  newString: z.string().describe("Replacement text; empty string to delete"),
});

export type EditFileResult =
  | { ok: true; value: { path: string; bytesWritten: number } }
  | { ok: false; error: string };

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + 1);
  }
  return count;
}

export function createEditFileTool(opts: { workingDirectory: string }) {
  return tool({
    description:
      "Replace an exact string in a file. oldString must match exactly once; include surrounding context to disambiguate. Use empty newString to delete.",
    inputSchema: editFileSchema,
    execute: async (args): Promise<EditFileResult> => {
      const resolved = resolveWithinRoot(opts.workingDirectory, args.path);

      let content: string;
      try {
        content = await fs.readFile(resolved, "utf-8");
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      const count = countOccurrences(content, args.oldString);
      if (count === 0) {
        return { ok: false, error: "oldString not found in file" };
      }
      if (count > 1) {
        return {
          ok: false,
          error: `oldString matches ${count} times; must be unique`,
        };
      }

      const start = content.indexOf(args.oldString);
      const newContent =
        content.slice(0, start) +
        args.newString +
        content.slice(start + args.oldString.length);

      const tmpPath = `${resolved}.tmp`;
      try {
        await fs.writeFile(tmpPath, newContent, "utf-8");
        await fs.rename(tmpPath, resolved);
      } catch (err) {
        try {
          await fs.unlink(tmpPath);
        } catch {
          // ignore cleanup failure
        }
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      const relativePath = path.relative(opts.workingDirectory, resolved);
      const bytesWritten = Buffer.byteLength(newContent, "utf-8");
      return { ok: true, value: { path: relativePath, bytesWritten } };
    },
  });
}
