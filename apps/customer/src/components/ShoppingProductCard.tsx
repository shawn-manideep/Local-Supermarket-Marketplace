import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { CustomerProduct, CustomerProductVariant } from "../lib/api";
import { activeVariants, canPurchaseVariant, productAvailabilityLabel, productPriceLabel } from "../lib/shopping";
import { colors, radius, spacing, typography } from "../theme";
import { PlaceholderImage } from "./PlaceholderImage";

export function ShoppingProductCard({ product, onOpen, onAdd, busy }: {
  product: CustomerProduct;
  onOpen: () => void;
  onAdd: (variant: CustomerProductVariant) => void;
  busy: boolean;
}) {
  const variants = activeVariants(product);
  const single = variants.length === 1 ? variants[0] : undefined;
  const quickAdd = single && canPurchaseVariant(product, single);
  const hasPurchasableVariant = variants.some(variant => canPurchaseVariant(product, variant));
  const actionLabel = busy ? "Adding…" : quickAdd ? "Add to Cart"
    : hasPurchasableVariant && variants.length > 1 ? "Choose an option"
    : hasPurchasableVariant ? "View details" : "Unavailable";
  return <View style={styles.card}>
    <Pressable accessibilityRole="button" accessibilityLabel={`View ${product.name}${product.storeName ? ` at ${product.storeName}` : ""}`} onPress={onOpen}>
      {product.imageUrl
        ? <Image source={{ uri: product.imageUrl }} style={styles.image} />
        : <PlaceholderImage name={product.name} style={styles.image} />}
      <View style={styles.info}>
        <Text style={typography.bodySemibold} numberOfLines={2}>{product.name}</Text>
        {!!product.brand && <Text style={typography.caption} numberOfLines={1}>{product.brand}</Text>}
        {!!product.storeName && <Text style={typography.caption} numberOfLines={2}>{product.storeName}</Text>}
        <Text style={[typography.title3, styles.price]} numberOfLines={2}>{productPriceLabel(product)}</Text>
        <Text style={[typography.caption, !product.purchasable && styles.unavailable]}>{productAvailabilityLabel(product)}</Text>
      </View>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`${actionLabel} ${product.name}`}
      accessibilityState={{ disabled: busy || !hasPurchasableVariant, busy }}
      disabled={busy || !hasPurchasableVariant}
      onPress={() => quickAdd && single ? onAdd(single) : onOpen()}
      style={[styles.action, (busy || !hasPurchasableVariant) && styles.busy]}>
      <Text style={styles.actionText}>{actionLabel}</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  card: { width: "48%", minWidth: 0, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: spacing.sm, marginBottom: spacing.md, justifyContent: "space-between" },
  image: { width: "100%", height: 104, borderRadius: radius.md, marginBottom: spacing.sm },
  info: { gap: spacing.xs, marginBottom: spacing.sm, minWidth: 0 },
  price: { flexShrink: 1, marginTop: spacing.xs },
  unavailable: { color: colors.danger },
  action: { backgroundColor: colors.accent, borderRadius: radius.sm, minHeight: 40, padding: spacing.xs, alignItems: "center", justifyContent: "center" },
  actionText: { ...typography.bodySemibold, color: colors.card, textAlign: "center", fontSize: 12 },
  busy: { opacity: 0.6 },
});