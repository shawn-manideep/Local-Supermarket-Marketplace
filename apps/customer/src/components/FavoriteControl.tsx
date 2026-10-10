import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { CustomerText as Text } from "./CustomerTypography";
import type { CustomerProduct } from "../lib/api";
import { colors, radius, spacing, typography } from "../theme";
import { useSavedItems } from "../SavedItemsContext";
import { useTranslation, localizeCustomerMessage } from "@workspace/localization";

export function FavoriteControl({ product, pincode, compact = false }: {
  product: CustomerProduct;
  pincode?: string;
  compact?: boolean;
}) {
  const { isSaved, toggle } = useSavedItems();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saved = isSaved(product.id);
  const onPress = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await toggle(product, pincode); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't update saved items."); }
    finally { setBusy(false); }
  };
  return <View style={styles.wrap}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={saved ? `${t("Remove {name} from saved items", { name: product.name })}` : t("Save {name}", { name: product.name })}
      accessibilityState={{ selected: saved, disabled: busy, busy }}
      disabled={busy}
      onPress={event => { event.stopPropagation(); void onPress(); }}
      style={[styles.button, compact && styles.compact, saved && styles.saved, busy && styles.busy]}
    >
      <Text style={[styles.label, saved && styles.savedLabel]}>{saved ? t("♥ Saved") : t("♡ Save")}</Text>
    </Pressable>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{localizeCustomerMessage(error, t)}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  button: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  compact: { minHeight: 44, paddingHorizontal: spacing.sm, alignSelf: "flex-start" },
  saved: { borderColor: colors.accent, backgroundColor: colors.soft },
  busy: { opacity: 0.55 },
  label: { ...typography.caption, color: colors.ink, fontWeight: "600" },
  savedLabel: { color: colors.accent },
  error: { ...typography.caption, color: colors.danger, maxWidth: 180 },
});
