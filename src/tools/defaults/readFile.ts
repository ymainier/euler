import { tool } from "ai";
import { z } from "zod";
import fs from "node:fs/promises";
import { resolveWithinRoot } from "./pathGuard.ts";

const MAX_LINES = 2000;
const MAX_BYTES = 100 * 1024;

const readFileSchema = z.object({
  path: z.string().describe("Path relative to the working directory"),
  offsetLines: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("1-indexed starting line (default: 1)"),
  limitLines: z
    .number()
    .int()
    .min(1)
    .max(2000)
    .optional()
    .describe("Max lines to return"),
});

export type ReadFileResult =
  | {
      ok: true;
      value: { content: string; totalLines: number; truncated: boolean };
    }
  | { ok: false; error: string };

export function createReadFileTool(opts: { workingDirectory: string }) {
  return tool({
    description:
      "Read a text file relative to the working directory. Returns content with 1-indexed line numbers. Use offsetLines/limitLines for large files. Fails on binary files.",
    inputSchema: readFileSchema,
    execute: async (args): Promise<ReadFileResult> => {
      const resolved = resolveWithinRoot(opts.workingDirectory, args.path);

      let data: Buffer;
      try {
        data = await fs.readFile(resolved);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      if (data.includes(0)) {
        return { ok: false, error: "binary file" };
      }

      const text = data.toString("utf-8");
      const rawLines = text.split("\n");
      const lines =
        text.endsWith("\n") && rawLines[rawLines.length - 1] === ""
          ? rawLines.slice(0, -1)
          : rawLines;
      const totalLines = lines.length;

      const startIdx =
        args.offsetLines !== undefined ? args.offsetLines - 1 : 0;
      const effectiveLimit = Math.min(args.limitLines ?? MAX_LINES, MAX_LINES);

      // Apply byte cap within the line window
      let lineCount = 0;
      let byteCount = 0;
      for (
        let i = startIdx;
        i < Math.min(startIdx + effectiveLimit, lines.length);
        i++
      ) {
        byteCount += Buffer.byteLength(lines[i] ?? "", "utf-8") + 1;
        if (byteCount > MAX_BYTES) break;
        lineCount++;
      }

      const endIdx = startIdx + lineCount;
      const selectedLines = lines.slice(startIdx, endIdx);
      const truncated = endIdx < totalLines;
      const omitted = totalLines - endIdx;

      const numbered = selectedLines
        .map((line, i) => `${String(startIdx + i + 1).padStart(6)}\t${line}`)
        .join("\n");
      const content = truncated
        ? `${numbered}\n... [${omitted} lines omitted]`
        : numbered;

      return { ok: true, value: { content, totalLines, truncated } };
    },
  });
}
