import { StyleSheet, Platform } from "react-native";

export const colors = {
  bg: "#F6F8FD",
  card: "#FFFFFF",
  ink: "#102756",
  muted: "#71809C",
  accent: "#1251CE",
  soft: "#E8F0FF",
  line: "#E3E9F4",
  danger: "#C7474A",
  highlight: "#FFF0EF",
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
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const typography = StyleSheet.create({
  hero: { fontSize: 25, fontWeight: "800", color: colors.ink, lineHeight: 32 },
  title1: { fontSize: 21, fontWeight: "800", color: colors.ink, lineHeight: 27 },
  title2: { fontSize: 18, fontWeight: "800", color: colors.ink, lineHeight: 24 },
  title3: { fontSize: 17, fontWeight: "800", color: colors.ink, lineHeight: 22 },
  body: { fontSize: 15, fontWeight: "400", color: colors.muted, lineHeight: 22 },
  bodySemibold: { fontSize: 15, fontWeight: "600", color: colors.ink, lineHeight: 22 },
  caption: { fontSize: 13, fontWeight: "500", color: colors.muted, lineHeight: 18 },
  eyebrow: { fontSize: 11, fontWeight: "800", color: colors.accent, letterSpacing: 1.2, textTransform: "uppercase" },
});

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
