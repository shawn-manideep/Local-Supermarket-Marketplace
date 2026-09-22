import { StyleSheet, Platform } from "react-native";

export const colors = {
  bg: "#F9F8F6",
  card: "#FFFFFF",
  ink: "#0F3D24", // Deep spinach green
  muted: "#607A6A",
  accent: "#DE4A22", // Ripe tomato
  soft: "#E8F0EB",
  line: "#E3E0D8",
  danger: "#D83A27",
  highlight: "#FFF0EB",
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
  hero: { fontSize: 32, fontWeight: "800", color: colors.ink, lineHeight: 38 },
  title1: { fontSize: 24, fontWeight: "800", color: colors.ink, lineHeight: 30 },
  title2: { fontSize: 20, fontWeight: "800", color: colors.ink, lineHeight: 26 },
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
    paddingTop: Platform.OS === "web" ? 67 : 24,
    paddingBottom: 100,
    backgroundColor: colors.bg,
    flexGrow: 1,
  },
  container: {
    paddingHorizontal: spacing.lg,
    maxWidth: 760,
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
