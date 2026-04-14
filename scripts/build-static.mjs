#!/usr/bin/env node
/**
 * build-static.mjs
 * Generates a fully static export of the app (output: 'export' → ./out/).
 *
 * Next.js cannot statically export API routes, so this script:
 *   1. Temporarily moves src/app/api → src/app/_api_bak
 *   2. Runs `next build` with NEXT_EXPORT=1
 *   3. Restores the API directory (even on error / SIGINT)
 *
 * Usage:
 *   node scripts/build-static.mjs
 * Or via npm:
 *   npm run build:static
 */

import { execSync } from "child_process";
import { renameSync, existsSync } from "fs";
import { join } from "path";

const root = process.cwd();
const apiDir = join(root, "src", "app", "api");
const apiDirBak = join(root, "src", "app", "_api_bak");

let restored = false;

function restore() {
  if (!restored && existsSync(apiDirBak)) {
    renameSync(apiDirBak, apiDir);
    restored = true;
    console.log("✓ Restored src/app/api");
  }
}

// Always restore on exit
process.on("exit", restore);
process.on("SIGINT", () => { restore(); process.exit(1); });
process.on("SIGTERM", () => { restore(); process.exit(1); });

// 1. Hide API routes
if (existsSync(apiDir)) {
  renameSync(apiDir, apiDirBak);
  console.log("→ Temporarily hid src/app/api (incompatible with static export)");
}

// 2. Build
try {
  execSync("npx next build", {
    stdio: "inherit",
    env: { ...process.env, NEXT_EXPORT: "1" },
  });
  console.log("\n✅ Static export complete → ./out/");
} catch (err) {
  console.error("\n❌ Build failed:", err.message);
  restore();
  process.exit(1);
}

// 3. Restore (also called via process.on('exit'))
restore();
