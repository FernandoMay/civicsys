/**
 * Node-only helpers (uses `node:fs`). Import from `@brugulacivica/sdk/node`.
 * Kept separate so the browser bundle never pulls in fs.
 */
import { readFileSync } from "node:fs";
import { parseDeployment } from "./config.js";
import type { DeploymentRecord } from "./types.js";

export * from "./index.js";

export function loadDeployment(path: string): DeploymentRecord {
  return parseDeployment(JSON.parse(readFileSync(path, "utf8")));
}
