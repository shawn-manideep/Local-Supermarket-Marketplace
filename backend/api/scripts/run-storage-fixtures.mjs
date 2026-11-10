import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const guard = fileURLToPath(new URL("./fixture-network-guard.mjs", import.meta.url));
const mode = process.argv[2];
if (process.argv.length !== 3 || !["unit", "routes", "regression", "rehearsal"].includes(mode)) {
  process.stderr.write("Select a predefined fixture verification mode.\n");
  process.exitCode = 1;
} else {
  const unitFiles = [
    "src/storage/external-gcs.test.ts", "src/api-only/target-guard.test.ts",
    "src/storage/provider.test.ts", "src/storage/replit-object-storage.test.ts",
    "src/branding/branding.test.ts",
    "src/storage/r2.test.ts",
    "src/storage/r2-routing.test.ts",
    "src/storage/supabase-storage.test.ts", "src/storage/supabase-assets.test.ts",
    "src/storage/supabase-live-assets.test.ts", "src/storage/asset-storage-fallback.test.ts",
  ];
  const routeFiles = [
    "src/vendor-documents/vendor-documents.integration.test.ts",
    "src/orders/consolidated-enhancements.integration.test.ts",
  ];
  async function testFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const groups = await Promise.all(entries.map(entry =>
      entry.isDirectory() ? testFiles(resolve(directory, entry.name))
        : entry.name.endsWith(".test.ts") ? [resolve(directory, entry.name)] : [],
    ));
    return groups.flat().sort();
  }
  const discovered = mode === "regression" ? await testFiles(resolve(root, "src")) : [];
  const inventoryRoot = `${resolve(root, "src/inventory")}${sep}`;
  const inventoryFiles = discovered.filter(file => file.startsWith(inventoryRoot));
  const otherFiles = discovered.filter(file => !file.startsWith(inventoryRoot));
  if (mode === "regression" && (inventoryFiles.length === 0 || otherFiles.length === 0)) {
    throw new Error("Regression discovery requires both fixture groups.");
  }
  const args = mode === "rehearsal"
    ? ["src/storage/rehearsal-cli.ts", "--synthetic-only"]
    : ["--experimental-test-module-mocks", "--test", "--test-concurrency=2", ...(mode === "unit" ? unitFiles
      : mode === "routes" ? routeFiles : otherFiles)];
  // Do not inherit production configuration, secrets, ADC paths or proxy settings.
  const fixtureEnv = {
    PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "",
    NODE_OPTIONS: `--import=${guard}`,
    ...(mode === "routes" ? { RUN_EXTERNAL_GCS_FIXTURES: "1" } : {}),
  };
  async function runGroup(label, childArgs, env) {
    process.stdout.write(`Fixture group: ${label}\n`);
    return new Promise(resolveResult => {
      const child = spawn(process.execPath, childArgs, {
        cwd: root, env, stdio: "inherit",
      });
      child.on("error", () => {
        process.stderr.write("Fixture verification could not start.\n");
        resolveResult(false);
      });
      child.on("close", code => { resolveResult(code === 0); });
    });
  }
  const fixturePassed = await runGroup(
    mode === "regression" ? `non-inventory (${otherFiles.length} files)` : mode,
    ["--import", "tsx", ...args], fixtureEnv,
  );
  let inventoryPassed = true;
  if (mode === "regression") {
    const inventoryGuard = fileURLToPath(new URL("./inventory-no-io-guard.mjs", import.meta.url));
    inventoryPassed = await runGroup(
      `inventory (${inventoryFiles.length} files)`,
      ["--import", inventoryGuard, "--import", "tsx", "--test",
        "--test-concurrency=1", ...inventoryFiles],
      {},
    );
  }
  process.exitCode = fixturePassed && inventoryPassed ? 0 : 1;
}
