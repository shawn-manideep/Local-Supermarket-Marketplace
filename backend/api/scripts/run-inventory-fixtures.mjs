import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
if (process.argv.length !== 2) {
  process.stderr.write("Inventory fixture runner accepts no arguments.\n");
  process.exitCode = 1;
} else {
  const guard = fileURLToPath(new URL("./inventory-no-io-guard.mjs", import.meta.url));
  const child = spawn(process.execPath, [
    "--import", guard, "--import", "tsx", "--test", "--test-concurrency=1",
    "src/inventory/inventory.test.ts",
  ], {
    cwd: root,
    env: {}, // No application variables, proxy settings, HOME, ADC or credentials.
    stdio: "inherit",
  });
  child.on("error", () => {
    process.stderr.write("Inventory fixture verification could not start.\n");
    process.exitCode = 1;
  });
  child.on("exit", code => { process.exitCode = code ?? 1; });
}
