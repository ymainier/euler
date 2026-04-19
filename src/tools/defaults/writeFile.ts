import { tool } from "ai";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "./pathGuard.ts";

const writeFileSchema = z.object({
  path: z.string().describe("Path relative to the working directory"),
  content: z.string().describe("Full file content; overwrites if file exists"),
});

export type WriteFileResult =
  | { ok: true; value: { path: string; bytesWritten: number } }
  | { ok: false; error: string };

export function createWriteFileTool(opts: { workingDirectory: string }) {
  return tool({
    description:
      "Create or overwrite a file relative to the working directory. Creates parent directories if needed. Writes atomically.",
    inputSchema: writeFileSchema,
    execute: async (args): Promise<WriteFileResult> => {
      const resolved = resolveWithinRoot(opts.workingDirectory, args.path);
      const tmpPath = `${resolved}.tmp`;

      try {
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(tmpPath, args.content, "utf-8");
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
      const bytesWritten = Buffer.byteLength(args.content, "utf-8");
      return { ok: true, value: { path: relativePath, bytesWritten } };
    },
  });
}
