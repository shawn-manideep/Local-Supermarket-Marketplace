import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, radius, typography } from "../theme";

export function PlaceholderImage({ name, style }: { name: string; style?: any }) {
  const initial = name.charAt(0).toUpperCase();
  return (
    <View style={[styles.container, style]}>
      <Text style={styles.text}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.soft, justifyContent: "center", alignItems: "center", borderRadius: radius.md },
  text: { ...typography.title2, color: colors.muted, opacity: 0.5 },
});
