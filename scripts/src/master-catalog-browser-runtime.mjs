import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BrowserCDP } from "./master-catalog-cdp.mjs";

export async function browserStartupProbe(executable) {
  const profile = await mkdtemp(path.join(os.tmpdir(), "master-catalog-cdp-probe-"));
  const browser = new BrowserCDP(executable, profile);
  try { await browser.send("Browser.getVersion", {}, undefined, 6000); return true; }
  catch { return false; }
  finally {
    await browser.close();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

export async function writeSanitizedReport(directory, report, checks) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return JSON.stringify({
    passed: report.passed, assertionCount: checks.length,
    passedAssertions: checks.filter((item) => item.passed).length,
    failedAssertions: checks.filter((item) => !item.passed).map((item) => item.name),
    report: "artifacts/catalog-verification/report.json", screenshots: report.screenshots,
  });
}

export async function dispatch(args, { run, preflight, root, chromePath }) {
  if (args.includes("--preflight")) return preflight(chromePath, root);
  if (args.includes("--run") || args.includes("--resume-after-vendor-catalog")) return run();
  if (args.includes("--browser-probe")) {
    let passed = false;
    try { passed = await browserStartupProbe(chromePath); } catch {}
    process.stdout.write(`${JSON.stringify({ mode: "unauthenticated Browser.getVersion probe", passed })}\n`);
    if (!passed) process.exitCode = 1;
    return;
  }
  process.stdout.write("Use --preflight or --browser-probe for read-only checks; use --run or --resume-after-vendor-catalog only after explicit readiness approval.\n");
}