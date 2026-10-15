export function isForegroundAppActive(
  appState: string | null,
  platform: string,
  documentVisible = true,
): boolean {
  return platform === "web" ? documentVisible : appState === "active";
}
