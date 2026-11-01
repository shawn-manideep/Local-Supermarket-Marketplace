import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.argv.length !== 2) {
  process.stderr.write("Offline Supabase fixture runner accepts no arguments.\n");
  process.exitCode = 1;
} else {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const guard = fileURLToPath(new URL("./inventory-no-io-guard.mjs", import.meta.url));
  const child = spawn(process.execPath, [
    "--import", guard, "--import", "tsx", "--experimental-test-module-mocks",
    "--test", "--test-concurrency=1",
    "src/storage/supabase-storage.test.ts", "src/storage/supabase-assets.test.ts",
  ], { cwd: root, env: {}, stdio: "inherit" });
  child.on("error", () => {
    process.stderr.write("Offline Supabase fixture verification could not start.\n");
    process.exitCode = 1;
  });
  child.on("exit", code => { process.exitCode = code ?? 1; });
}
