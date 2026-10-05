import { StyleSheet, Platform } from "react-native";
import { theme } from "@workspace/constants";
import { webViewportFlex } from "./lib/viewport-layout";

export const colors = {
  bg: theme.colors.lightBlue,
  card: theme.colors.white,
  ink: theme.colors.navy,
  text: theme.colors.text,
  muted: theme.colors.secondaryText,
  accent: theme.colors.primary,
  success: theme.colors.success,
  shadow: theme.colors.shadow,
  soft: theme.colors.softBlue,
  line: theme.colors.border,
  danger: theme.colors.error,
  highlight: theme.colors.errorSoft,
  overlay: theme.colors.whiteOverlay,
  navyOverlay: theme.colors.navyOverlay,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: theme.radius.sm,
  md: theme.radius.md,
  lg: theme.radius.card,
  xl: theme.radius.large,
  full: theme.radius.full,
};

export const fontWeights = theme.typography.weights;
const interFont = Platform.select({
  web: theme.typography.fontFamily,
  ios: "System",
  android: "sans-serif",
  default: "sans-serif",
});

export const typography = StyleSheet.create({
  hero: { fontFamily: interFont, fontSize: 25, fontWeight: fontWeights.bold, color: colors.ink, lineHeight: 32 },
  title1: { fontFamily: interFont, fontSize: 21, fontWeight: fontWeights.bold, color: colors.ink, lineHeight: 27 },
  title2: { fontFamily: interFont, fontSize: 18, fontWeight: fontWeights.semibold, color: colors.ink, lineHeight: 24 },
  title3: { fontFamily: interFont, fontSize: 17, fontWeight: fontWeights.semibold, color: colors.ink, lineHeight: 22 },
  body: { fontFamily: interFont, fontSize: 15, fontWeight: fontWeights.regular, color: colors.text, lineHeight: 22 },
  bodySemibold: { fontFamily: interFont, fontSize: 15, fontWeight: fontWeights.semibold, color: colors.text, lineHeight: 22 },
  caption: { fontFamily: interFont, fontSize: 13, fontWeight: fontWeights.medium, color: colors.muted, lineHeight: 18 },
  eyebrow: { fontFamily: interFont, fontSize: 11, fontWeight: fontWeights.medium, color: colors.accent, letterSpacing: 1.2, textTransform: "uppercase" },
});

export const fontFamily = theme.typography.fontFamily;

export const shadows = {
  sm: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  md: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
  },
};

export const commonStyles = StyleSheet.create({
  // ScrollView already supplies overflow-y:auto on web. Bound its height,
  // rather than enabling a second scrolling area on the document.
  viewport: Platform.OS === "web" ? webViewportFlex : {},
  page: {
    paddingTop: Platform.OS === "web" ? 24 : 24,
    paddingBottom: 100,
    backgroundColor: colors.bg,
    flexGrow: 1,
  },
  container: {
    paddingHorizontal: spacing.lg,
    maxWidth: 430,
    width: "100%",
    alignSelf: "center",
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
  },
});
