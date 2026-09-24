import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const taskRoot = process.cwd();
const environment = {
  ...process.env,
  // This mirrors the Pages workflow without relying on shell-specific
  // environment-variable syntax.
  VITE_STATIC_PREVIEW: "true",
  VITE_BASE_PATH: process.env.VITE_BASE_PATH ?? "/",
};

function runNodeScript(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: taskRoot,
    env: environment,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

runNodeScript(resolve(taskRoot, "node_modules", "typescript", "bin", "tsc"), ["-p", "tsconfig.server.json"]);
runNodeScript(resolve(taskRoot, "node_modules", "vite", "bin", "vite.js"), ["build"]);
