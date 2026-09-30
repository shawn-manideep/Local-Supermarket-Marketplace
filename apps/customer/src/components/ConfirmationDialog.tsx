import React from "react";
import { Modal, View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
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
  overlay: { flex: 1, backgroundColor: "rgba(15, 61, 36, 0.4)", justifyContent: "center", alignItems: "center", padding: spacing.xl },
  dialog: { width: "100%", maxWidth: 320, backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.md, ...shadows.md },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.md, marginTop: spacing.sm },
  cancelBtn: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radius.md, justifyContent: "center", alignItems: "center" },
  cancelText: { ...typography.bodySemibold, color: colors.muted },
  confirmBtn: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.ink, justifyContent: "center", alignItems: "center", minWidth: 100 },
  destructiveBtn: { backgroundColor: colors.danger },
  confirmText: { ...typography.bodySemibold, color: colors.card },
});
