import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors, radius, typography } from "../theme";

interface QuantitySelectorProps {
  quantity: number;
  onDecrease: () => void;
  onIncrease: () => void;
  min?: number;
  disabled?: boolean;
}

export function QuantitySelector({ quantity, onDecrease, onIncrease, min = 0, disabled }: QuantitySelectorProps) {
  return (
    <View style={[styles.container, disabled && styles.disabled]}>
      <Pressable accessibilityRole="button" disabled={quantity <= min || disabled} onPress={onDecrease} style={styles.btn}>
        <Text style={styles.btnText}>−</Text>
      </Pressable>
      <Text style={styles.qty}>{quantity}</Text>
      <Pressable accessibilityRole="button" disabled={disabled} onPress={onIncrease} style={styles.btn}>
        <Text style={styles.btnText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: "row", alignItems: "center", backgroundColor: colors.soft, borderRadius: radius.full, overflow: "hidden" },
  disabled: { opacity: 0.5 },
  btn: { width: 36, height: 36, justifyContent: "center", alignItems: "center" },
  btnText: { fontSize: 18, fontWeight: "600", color: colors.ink, marginTop: -2 },
  qty: { minWidth: 24, textAlign: "center", ...typography.bodySemibold, color: colors.ink },
});
