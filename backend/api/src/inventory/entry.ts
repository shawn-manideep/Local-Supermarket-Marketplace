import { main, serializeReport } from "./cli.js";

// No input echo, stack traces, stderr diagnostics, or inherited environment reads.
try {
  const report = await main(process.argv.slice(2), process.stdin);
  process.stdout.write(`${serializeReport(report)}\n`);
  process.exitCode = report.complete ? 0 : 1;
} catch {
  process.stdout.write('{"complete":false,"status":"incomplete","failure":"READER_FAILED"}\n');
  process.exitCode = 1;
} finally { process.stdin.destroy(); }
