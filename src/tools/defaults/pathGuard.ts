import path from "node:path";
import fs from "node:fs";

export function resolveWithinRoot(root: string, requested: string): string {
  const resolved = path.resolve(root, requested);
  const relativeToRoot = path.relative(root, resolved);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error(`path escapes working directory: ${requested}`);
  }

  let realRoot: string;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return resolved;
  }

  // Walk up to the nearest existing path component to detect symlink escapes
  let checkPath = resolved;
  for (;;) {
    try {
      const realCheck = fs.realpathSync(checkPath);
      const realRel = path.relative(realRoot, realCheck);
      if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
        throw new Error(`path escapes working directory: ${requested}`);
      }
      break;
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes("path escapes working directory")
      ) {
        throw err;
      }
      const parent = path.dirname(checkPath);
      if (parent === checkPath) break;
      checkPath = parent;
    }
  }

  return resolved;
}
