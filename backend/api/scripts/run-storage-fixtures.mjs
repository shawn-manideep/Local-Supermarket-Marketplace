import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

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
  const args = mode === "rehearsal"
    ? ["src/storage/rehearsal-cli.ts", "--synthetic-only"]
    : ["--test", "--test-concurrency=2", ...(mode === "unit" ? unitFiles
      : mode === "routes" ? routeFiles : await testFiles(resolve(root, "src")))];
  // Do not inherit production configuration, secrets, ADC paths or proxy settings.
  const child = spawn(process.execPath, ["--import", "tsx", ...args], {
    cwd: root,
    env: {
      PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "",
      NODE_OPTIONS: `--import=${guard}`,
      ...(mode === "routes" ? { RUN_EXTERNAL_GCS_FIXTURES: "1" } : {}),
    },
    stdio: "inherit",
  });
  child.on("error", () => {
    process.stderr.write("Fixture verification could not start.\n");
    process.exitCode = 1;
  });
  child.on("exit", code => { process.exitCode = code ?? 1; });
}
