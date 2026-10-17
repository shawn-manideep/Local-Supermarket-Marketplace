import { readFileSync } from "node:fs";
import { nativeConfigurationIssues } from "../src/lib/native-readiness.mjs";

// Dedicated public build variables only: never copy server credentials or use
// SUPABASE_* / FRESH_* / DATABASE_URL as automatic build-variable fallbacks.
const config = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  // A missing or unknown build profile must not inherit the runtime default.
  profile: process.env.EAS_BUILD_PROFILE ?? "",
};
const issues = nativeConfigurationIssues(config);
const app = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")).expo;
const eas = JSON.parse(readFileSync(new URL("../eas.json", import.meta.url), "utf8"));
const selectedBuild = eas.build?.[config.profile];
if (!config.profile || !selectedBuild) {
  issues.push("EAS_BUILD_PROFILE must select an explicitly configured Customer build profile.");
}
if (config.profile !== "preview") {
  issues.push("Only the explicitly approved preview Customer APK profile is enabled.");
}
if (app.android?.package !== "com.apnalocalbasket.customer"
  || app.extra?.eas?.projectId !== "7c05eb94-461f-4ca5-ba66-45aa8311cdc5"
  || app.owner !== "apna-local-basket") {
  issues.push("The approved Android/EAS project identity does not match.");
}
if (selectedBuild?.android?.buildType !== "apk"
  || selectedBuild?.distribution !== "internal") {
  issues.push("The preview profile must produce an internally distributed APK.");
}
if (issues.length) {
  for (const issue of issues) process.stderr.write(`NOT READY: ${issue}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Public configuration and APK profile checks passed. Real API/database readiness and authentication remain separate release gates.\n");
}
