import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState, Image, Platform, StyleSheet, View } from "react-native";
import { CustomerText as Text } from "./CustomerTypography";
import { customerImageUri } from "../lib/api";
import { colors, radius, typography } from "../theme";

type Branding = { logoUrl: string | null; revision: string | null };
let config: Branding | null = null;
const listeners = new Set<() => void>();
let started = false;
let loading = false;
async function refresh() {
  if (loading) return;
  loading = true;
  try {
    const response = await fetch(customerImageUri("/api/branding")!, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error();
    const result = await response.json() as Branding;
    config = { logoUrl: result.logoUrl === "/api/branding/logo" ? result.logoUrl : null,
      revision: typeof result.revision === "string" ? result.revision : null };
  } catch { config = null; }
  finally { loading = false; listeners.forEach(listener => listener()); }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!started) {
    started = true;
    void refresh();
    setInterval(() => void refresh(), 60_000);
    AppState.addEventListener("change", state => { if (state === "active") void refresh(); });
    if (Platform.OS === "web" && typeof window !== "undefined") window.addEventListener("focus", () => void refresh());
  }
  return () => { listeners.delete(listener); };
}
export function CustomerBrandingLogo({ size = 40, fallback }: { size?: number; fallback?: ReactNode }) {
  const branding = useSyncExternalStore(subscribe, () => config, () => null);
  const source = branding?.logoUrl ? customerImageUri(`${branding.logoUrl}?revision=${encodeURIComponent(branding.revision ?? "")}`) : undefined;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  if (!source || failed) return fallback ?? <View accessibilityLabel="Apna Local Basket" style={[styles.fallback, { width: size, height: size }]}><Text style={styles.text}>ALB</Text></View>;
  return <Image source={{ uri: source }} accessibilityLabel="Apna Local Basket" resizeMode="contain"
    style={{ width: size, height: size, flexShrink: 0 }} onError={() => setFailed(true)} />;
}
const styles = StyleSheet.create({
  fallback: { backgroundColor: colors.accent, borderRadius: radius.md, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  text: { ...typography.bodySemibold, color: colors.card },
});
