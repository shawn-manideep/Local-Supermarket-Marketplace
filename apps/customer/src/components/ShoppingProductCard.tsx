import { Image, Pressable, StyleSheet, View } from "react-native";
import { CustomerText as Text } from "./CustomerTypography";
import type { CustomerProduct, CustomerProductVariant } from "../lib/api";
import { activeVariants, canPurchaseVariant, productAvailabilityLabel, productPriceLabel } from "../lib/shopping";
import { colors, radius, spacing, typography } from "../theme";
import { PlaceholderImage } from "./PlaceholderImage";
import { FavoriteControl } from "./FavoriteControl";
import { customerImageUri } from "../lib/api";
import { useTranslation, localizeCustomerMessage } from "@workspace/localization";

export function ShoppingProductCard({ product, onOpen, onAdd, busy, pincode, singleColumn = false, quickAddEnabled = true, storeOperatingStatus, canScheduleWhileClosed = false }: {
  product: CustomerProduct;
  onOpen: () => void;
  onAdd: (variant: CustomerProductVariant) => void;
  busy: boolean;
  pincode?: string;
  singleColumn?: boolean;
  quickAddEnabled?: boolean;
  storeOperatingStatus?: "OPEN" | "CLOSED";
  canScheduleWhileClosed?: boolean;
}) {
  const { t } = useTranslation();
  const variants = activeVariants(product);
  const single = variants.length === 1 ? variants[0] : undefined;
  const quickAdd = single && canPurchaseVariant(product, single);
  const hasPurchasableVariant = variants.some(variant => canPurchaseVariant(product, variant));
  const storeUnavailable = storeOperatingStatus === "CLOSED" && !canScheduleWhileClosed;
  const priceLabel = productPriceLabel(product);
  const translatedPrice = priceLabel === "No selling options" ? t("No selling options")
    : priceLabel === "Price unavailable" ? t("Price unavailable")
    : priceLabel.startsWith("From ") ? t("From {price}", { price: priceLabel.slice(5) }) : priceLabel;
  const actionLabel = busy ? t("Adding…") : storeUnavailable ? t("Currently Closed") : quickAdd && quickAddEnabled ? t("Add to Cart")
    : hasPurchasableVariant ? t("View details")
    : t("Unavailable");
  return <View style={[styles.card, singleColumn && styles.singleColumn]}>
    <Pressable accessibilityRole="button" accessibilityLabel={t("View {product}{store}", { product: product.name, store: product.storeName ? ` at ${product.storeName}` : "" })} onPress={onOpen}>
      {customerImageUri(product.imageUrl)
        ? <Image source={{ uri: customerImageUri(product.imageUrl) }} resizeMode="contain" style={styles.image} />
        : <PlaceholderImage name={product.name} style={styles.image} />}
      <View style={styles.info}>
        <Text style={[typography.bodySemibold, styles.productName]} numberOfLines={2}>{product.name}</Text>
        {!!product.brand && <Text style={typography.caption} numberOfLines={1}>{product.brand}</Text>}
        {!!product.storeName && <Text style={typography.caption} numberOfLines={1}>{product.storeName}</Text>}
        <Text style={[typography.title3, styles.price]} numberOfLines={2}>{translatedPrice}</Text>
        <Text style={[typography.caption, !product.purchasable && styles.unavailable]} numberOfLines={1}>{localizeCustomerMessage(productAvailabilityLabel(product), t)}</Text>
      </View>
    </Pressable>
    <FavoriteControl product={product} pincode={pincode} compact />
    <Pressable accessibilityRole="button" accessibilityLabel={`${actionLabel} ${product.name}`}
      accessibilityState={{ disabled: busy || storeUnavailable || !hasPurchasableVariant, busy }}
      disabled={busy || storeUnavailable || !hasPurchasableVariant}
      onPress={() => quickAddEnabled && quickAdd && single ? onAdd(single) : onOpen()}
      style={[styles.action, (busy || !hasPurchasableVariant) && styles.busy]}>
      <Text style={styles.actionText}>{actionLabel}</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  card: { width: "48%", minWidth: 0, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: spacing.sm, marginBottom: spacing.md, justifyContent: "space-between" },
  singleColumn: { width: "100%" },
  image: { width: "100%", aspectRatio: 1.42, borderRadius: radius.md, marginBottom: spacing.sm, backgroundColor: colors.soft },
  info: { gap: spacing.xs, marginBottom: spacing.sm, minWidth: 0, flexGrow: 1 },
  productName: { minHeight: 40, lineHeight: 20 },
  price: { flexShrink: 1, marginTop: spacing.xs, lineHeight: 22 },
  unavailable: { color: colors.danger },
  action: { backgroundColor: colors.accent, borderRadius: radius.sm, minHeight: 44, padding: spacing.xs, alignItems: "center", justifyContent: "center" },
  actionText: { ...typography.bodySemibold, color: colors.card, textAlign: "center", fontSize: 12 },
  busy: { opacity: 0.6 },
});