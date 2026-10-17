import { readFileSync } from "node:fs";
import { nativeConfigurationIssues } from "../src/lib/native-readiness.mjs";

// Dedicated public build variables only: never copy server credentials or use
// SUPABASE_* / FRESH_* / DATABASE_URL as automatic build-variable fallbacks.
const config = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
};
const issues = nativeConfigurationIssues(config);
const app = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")).expo;
const eas = JSON.parse(readFileSync(new URL("../eas.json", import.meta.url), "utf8"));
if (app.android?.package !== "com.apnalocalbasket.customer"
  || app.extra?.eas?.projectId !== "7c05eb94-461f-4ca5-ba66-45aa8311cdc5"
  || app.owner !== "apna-local-basket") {
  issues.push("The approved Android/EAS project identity does not match.");
}
if (eas.build?.preview?.android?.buildType !== "apk"
  || eas.build?.preview?.distribution !== "internal") {
  issues.push("The preview profile must produce an internally distributed APK.");
}
// This hook currently protects isolated native-preview builds only.
if (!process.env.EAS_BUILD_PROFILE || process.env.EAS_BUILD_PROFILE === "preview") {
  if (config.supabaseUrl !== "https://nrnigsznectrgbgafwme.supabase.co") {
    issues.push("The preview profile must target the approved isolated Supabase project.");
  }
}
if (issues.length) {
  for (const issue of issues) process.stderr.write(`NOT READY: ${issue}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Public configuration and APK profile checks passed. Real API/database readiness and authentication remain separate release gates.\n");
}
