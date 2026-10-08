import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { CustomerText as Text } from "./components/CustomerTypography";
import { customerImageUri } from "./lib/api";
import { useSavedItems, type SavedItem } from "./SavedItemsContext";
import { colors, commonStyles, radius, spacing, typography } from "./theme";
import { PlaceholderImage } from "./components/PlaceholderImage";
import { productPriceLabel } from "./lib/shopping";
import { formatVariantName } from "@workspace/validation/variant-formatting";

export function SavedItemsScreen({ pincode, onBack, onOpenItem }: {
  pincode?: string;
  onBack: () => void;
  onOpenItem: (productId: string, storeId: string) => void;
}) {
  const { items, loading, error, load, remove } = useSavedItems();
  const [actionError, setActionError] = useState("");
  useEffect(() => { void load(pincode); }, [load, pincode]);

  const removeItem = async (item: SavedItem) => {
    setActionError("");
    try { await remove(item.productId, pincode); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "Unable to remove this item."); }
  };

  return <ScrollView style={commonStyles.viewport} contentContainerStyle={commonStyles.page}>
    <View style={commonStyles.container}>
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}><Text style={styles.backText}>‹ My Account</Text></Pressable>
      <Text style={typography.eyebrow}>YOUR LIST</Text>
      <Text style={typography.hero}>Saved Items</Text>
      <Text style={[typography.body, styles.intro]}>Keep the groceries you’re considering close. Nothing here is reserved or added to your basket.</Text>
      {(error || actionError) ? <View style={styles.errorBox}>
        <Text accessibilityRole="alert" style={styles.errorText}>{actionError || error}</Text>
        <Pressable accessibilityRole="button" onPress={() => void load(pincode)}><Text style={styles.backText}>Try again</Text></Pressable>
      </View> : null}
      {loading && items.length === 0 ? <View style={styles.loading}><ActivityIndicator color={colors.accent} /><Text style={typography.caption}>Loading your list…</Text></View> :
        items.length === 0 ? <View style={styles.empty}>
          <Text style={styles.emptyMark}>♡</Text>
          <Text style={typography.title2}>Your list starts here</Text>
          <Text style={[typography.body, styles.center]}>Save a product while browsing and it’ll be waiting here next time.</Text>
          <Pressable accessibilityRole="button" onPress={onBack} style={styles.primary}><Text style={styles.primaryText}>Back to shopping</Text></Pressable>
        </View> :
        <View style={styles.list}>
          {items.map(item => {
            const image = customerImageUri(item.product.imageUrl);
            const available = item.available && item.product.purchasable;
            const sellingOptions = (item.product.variants ?? []).filter(variant => variant.isActive).map(variant => formatVariantName(variant.quantityValue, variant.quantityUnit));
            return <View key={`${item.storeId}:${item.productId}`} style={styles.item}>
              {image ? <Image source={{ uri: image }} style={styles.image} resizeMode="cover" /> : <PlaceholderImage name={item.product.name} style={styles.image} />}
              <View style={styles.copy}>
                <Text style={typography.bodySemibold}>{item.product.name}</Text>
                {!!item.product.brand && <Text style={typography.caption}>{item.product.brand}</Text>}
                <Text style={typography.caption}>{item.storeName}</Text>
                <Text style={styles.price}>{productPriceLabel(item.product)}</Text>
                {!!sellingOptions.length && <Text style={typography.caption}>Options: {sellingOptions.join(" · ")}</Text>}
                <Text style={[typography.caption, !available && styles.unavailable]}>{available ? "Available to shop" : item.unavailableReason || "Currently unavailable"}</Text>
              </View>
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.product.name}`} onPress={() => void removeItem(item)} style={styles.remove}>
                  <Text style={styles.removeText}>Remove</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={!available || loading || Boolean(error)} onPress={() => onOpenItem(item.productId, item.storeId)} style={[styles.shop, (!available || loading || Boolean(error)) && styles.disabled]}>
                  <Text style={styles.shopText}>{available ? "View item" : "Unavailable"}</Text>
                </Pressable>
              </View>
            </View>;
          })}
        </View>}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  back: { alignSelf: "flex-start", paddingVertical: spacing.md },
  backText: { ...typography.bodySemibold, color: colors.accent },
  intro: { marginTop: spacing.sm, marginBottom: spacing.xl },
  loading: { padding: spacing.xl, alignItems: "center", gap: spacing.md },
  empty: { padding: spacing.xl, gap: spacing.md, alignItems: "center", backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.line },
  emptyMark: { color: colors.accent, fontSize: 42 },
  center: { textAlign: "center" },
  primary: { marginTop: spacing.sm, backgroundColor: colors.accent, minHeight: 48, width: "100%", alignItems: "center", justifyContent: "center", borderRadius: radius.md },
  primaryText: { ...typography.bodySemibold, color: colors.card },
  list: { gap: spacing.md },
  item: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: spacing.md },
  image: { width: 76, height: 76, borderRadius: radius.md, backgroundColor: colors.soft },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  price: { ...typography.bodySemibold, color: colors.accent, marginTop: spacing.xs },
  unavailable: { color: colors.danger },
  actions: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs },
  remove: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm },
  removeText: { ...typography.caption, color: colors.danger, fontWeight: "600" },
  shop: { backgroundColor: colors.accent, borderRadius: radius.md, minHeight: 44, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center" },
  shopText: { ...typography.caption, color: colors.card, fontWeight: "600" },
  disabled: { opacity: 0.5 },
  errorBox: { backgroundColor: colors.highlight, padding: spacing.md, borderRadius: radius.md, gap: spacing.sm, marginBottom: spacing.md },
  errorText: { ...typography.body, color: colors.danger },
});
