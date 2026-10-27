import { failedReport, serializeReport } from "./report.js";
import { validatePolicyOnly } from "./runner.js";
import type { Report } from "./contracts.js";

/**
 * Offline JSON on stdin only. No paths, environment variables, SDKs, credentials
 * or application bootstrap. Metadata execution cannot be unlocked by CLI flags.
 */
export async function main(args: readonly string[], input: AsyncIterable<Uint8Array | string>): Promise<Report> {
  if (args.length !== 1 || !["--mode=validate-policy-only", "--mode=metadata-only"].includes(args[0]!)) {
    return failedReport("validate-policy-only", "INVALID_POLICY");
  }
  const metadata = args[0] === "--mode=metadata-only";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const chunks: Buffer[] = [];
    await Promise.race([
      (async () => {
        let size = 0;
        for await (const chunk of input) {
          const buffer = Buffer.from(chunk);
          size += buffer.length;
          if (size > 16_384) throw new Error();
          chunks.push(buffer);
        }
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error()), 1000); }),
    ]);
    const report = validatePolicyOnly(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!report.complete) return metadata ? failedReport("metadata-only", "INVALID_POLICY") : report;
    return metadata ? failedReport("metadata-only", "LIVE_EXECUTION_UNAVAILABLE") : report;
  } catch { return failedReport(metadata ? "metadata-only" : "validate-policy-only", "INVALID_POLICY"); }
  finally { if (timer) clearTimeout(timer); }
}
// Separate bootstrap keeps imports side-effect-free for fixture tests.
export { serializeReport };
