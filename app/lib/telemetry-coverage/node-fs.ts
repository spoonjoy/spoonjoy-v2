/**
 * node:fs adapter for the telemetry-coverage audit's `FileSystem` port.
 *
 * Kept separate from `audit.ts` so the orchestrator stays pure and disk-free
 * for unit tests, while the vitest gate and any CLI use the real filesystem.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import type { FileSystem } from "./audit";

export const nodeFileSystem: FileSystem = {
  listFiles(dir: string): string[] {
    const out: string[] = [];
    const walk = (current: string) => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          walk(full);
        } else if (entry.isFile()) {
          out.push(full);
        }
      }
    };
    walk(dir);
    return out;
  },
  readFile(path: string): string {
    return readFileSync(path, "utf8");
  },
  exists(path: string): boolean {
    return existsSync(path);
  },
};
