import type { Tool } from "ai";
import { createReadFileTool } from "./readFile.ts";
import { createWriteFileTool } from "./writeFile.ts";
import { createEditFileTool } from "./editFile.ts";
import { createGrepTool } from "./grep.ts";
import { createGlobTool } from "./glob.ts";

export type DefaultToolsOptions = {
  workingDirectory: string;
  // bash omitted — add with needsApproval: true once the harness approval flow is wired
};

export function createDefaultTools(
  opts: DefaultToolsOptions,
): Record<string, Tool> {
  return {
    read_file: createReadFileTool(opts),
    write_file: createWriteFileTool(opts),
    edit_file: createEditFileTool(opts),
    grep: createGrepTool(opts),
    glob: createGlobTool(opts),
  };
}
