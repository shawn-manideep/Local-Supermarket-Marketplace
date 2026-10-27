import { runSyntheticRehearsal } from "./synthetic-rehearsal.js";

if (process.argv.length !== 3 || process.argv[2] !== "--synthetic-only") {
  process.stderr.write("Only --synthetic-only is supported. No live source or destination is accepted.\n");
  process.exitCode = 1;
} else {
  try {
    const report = await runSyntheticRehearsal();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.passed) process.exitCode = 1;
  } catch {
    // No raw exception, names, paths, credentials, or SDK responses in reports.
    process.stderr.write('{"mode":"synthetic-only","passed":false,"error":"Rehearsal failed"}\n');
    process.exitCode = 1;
  }
}
