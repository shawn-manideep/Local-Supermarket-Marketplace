import React from "react";
import { Modal, View, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { CustomerText as Text } from "./CustomerTypography";
import { colors, radius, typography, spacing, shadows } from "../theme";

interface ConfirmationDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDestructive?: boolean;
  loading?: boolean;
}

export function ConfirmationDialog({
  visible, title, message, confirmLabel, cancelLabel = "Cancel", onConfirm, onCancel, isDestructive, loading
}: ConfirmationDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Text style={typography.title2}>{title}</Text>
          <Text style={typography.body}>{message}</Text>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" style={styles.cancelBtn} onPress={onCancel} disabled={loading}>
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={[styles.confirmBtn, isDestructive && styles.destructiveBtn]} onPress={onConfirm} disabled={loading}>
              {loading ? <ActivityIndicator color={colors.card} /> : <Text style={styles.confirmText}>{confirmLabel}</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: "center", alignItems: "center", padding: spacing.md },
  dialog: { width: "100%", maxWidth: 320, backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.md, ...shadows.md },
  actions: { flexDirection: "column-reverse", justifyContent: "flex-end", gap: spacing.xs, marginTop: spacing.sm },
  cancelBtn: { minHeight: 44, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.md, justifyContent: "center", alignItems: "center" },
  cancelText: { ...typography.bodySemibold, color: colors.muted },
  confirmBtn: { minHeight: 48, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.ink, justifyContent: "center", alignItems: "center", minWidth: 100 },
  destructiveBtn: { backgroundColor: colors.danger },
  confirmText: { ...typography.bodySemibold, color: colors.card },
});
