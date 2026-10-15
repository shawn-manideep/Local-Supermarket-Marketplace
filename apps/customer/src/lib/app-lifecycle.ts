import { AppState, Platform } from "react-native";
import { isForegroundAppActive } from "./foreground-policy";

export function isCustomerAppForeground(): boolean {
  const documentVisible = Platform.OS !== "web"
    || typeof document === "undefined"
    || document.visibilityState === "visible";
  return isForegroundAppActive(AppState.currentState, Platform.OS, documentVisible);
}

export function subscribeToCustomerForeground(callback: () => void): () => void {
  const refreshIfForeground = () => {
    if (isCustomerAppForeground()) callback();
  };
  const subscription = AppState.addEventListener("change", state => {
    if (state === "active") refreshIfForeground();
  });

  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.addEventListener("focus", refreshIfForeground);
    document.addEventListener("visibilitychange", refreshIfForeground);
    window.addEventListener("online", refreshIfForeground);
  }
  return () => {
    subscription.remove();
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.removeEventListener("focus", refreshIfForeground);
      document.removeEventListener("visibilitychange", refreshIfForeground);
      window.removeEventListener("online", refreshIfForeground);
    }
  };
}
