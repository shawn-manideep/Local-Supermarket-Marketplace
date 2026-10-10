import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { CustomerText as Text } from "./CustomerTypography";
import { formatPrice, formatVariantName } from "@workspace/validation/variant-formatting";
import type { CustomerProduct, CustomerProductVariant, CustomerStore } from "../lib/api";
import { activeVariants, canPurchaseVariant, productAvailabilityLabel, productPriceLabel, variantAvailabilityLabel } from "../lib/shopping";
import { colors, commonStyles, radius, spacing, typography } from "../theme";
import { PlaceholderImage } from "./PlaceholderImage";
import { QuantitySelector } from "./QuantitySelector";
import { customerImageUri } from "../lib/api";
import { FavoriteControl } from "./FavoriteControl";
import { useTranslation, localizeCustomerMessage } from "@workspace/localization";

interface Props {
  product: CustomerProduct;
  store: CustomerStore;
  pincode: string;
  selectedVariantId: string;
  quantity: number;
  busy: boolean;
  hasCart: boolean;
  error: string;
  backLabel: string;
  onBack: () => void;
  onSelect: (variant: CustomerProductVariant) => void;
  onQuantityChange: (quantity: number) => void;
  onAdd: (variant: CustomerProductVariant) => void;
  favoriteControl?: React.ReactNode;
  closedStoreNotice?: React.ReactNode;
}

export function ShoppingProductDetails({
  product, store, pincode, selectedVariantId, quantity, busy, hasCart, error, backLabel,
  onBack, onSelect, onQuantityChange, onAdd, favoriteControl, closedStoreNotice,
}: Props) {
  const { t } = useTranslation();
  const variants = activeVariants(product);
  const selected = variants.find(variant => variant.id === selectedVariantId);
  const storeOpen = store.operatingStatus === "OPEN";
  const orderingAvailable = storeOpen || store.scheduledDeliveryAvailable === true;
  const purchasable = orderingAvailable && !!selected && canPurchaseVariant(product, selected);
  const status = productAvailabilityLabel(product);
  const priceLabel = productPriceLabel(product, selected);
  const translatedPrice = priceLabel === "No selling options" ? t("No selling options")
    : priceLabel === "Price unavailable" ? t("Price unavailable")
    : priceLabel.startsWith("From ") ? t("From {price}", { price: priceLabel.slice(5) }) : priceLabel;
  const needsChoice = !selected && variants.some(variant => canPurchaseVariant(product, variant));
  const addLabel = !orderingAvailable ? t("Currently Closed") : purchasable ? t("Add {quantity} to Cart", { quantity })
    : needsChoice ? t("Choose an option first") : selected ? localizeCustomerMessage(variantAvailabilityLabel(product, selected), t) : localizeCustomerMessage(status, t);
  return (
    <ScrollView style={commonStyles.viewport} contentContainerStyle={[commonStyles.page, hasCart && styles.cartClearance]}>
      <View style={commonStyles.container}>
        <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} style={styles.navigation}>
          <Text style={styles.link}>← {backLabel}</Text>
        </Pressable>
        <View style={styles.hero}>
          {customerImageUri(product.imageUrl) ? <Image source={{ uri: customerImageUri(product.imageUrl) }} style={styles.image} resizeMode="contain" />
            : <PlaceholderImage name={product.name} style={styles.image} />}
        </View>
        <Text style={typography.hero}>{product.name}</Text>
        {!!product.brand && <Text style={typography.bodySemibold}>{product.brand}</Text>}
          <Text style={[typography.bodySemibold, styles.store]}>{t("Sold by {store}", { store: store.name })}</Text>
        {!storeOpen && (closedStoreNotice ?? <View accessibilityRole="alert" style={styles.closedNotice}>
          <Text style={styles.closedTitle}>{t("Currently Closed")}</Text>
          <Text style={styles.closedCopy}>{store.scheduledDeliveryAvailable ? t("Instant delivery is paused. Add items now and choose an available future delivery time at checkout.") : t("You can browse this store, but no delivery option is available right now.")}</Text>
        </View>)}
        {favoriteControl ?? <FavoriteControl product={product} pincode={pincode} />}
        {!![store.locality, store.city, store.state, store.pincode].filter(Boolean).length && <Text style={typography.caption}>{[store.locality, store.city, store.state, store.pincode].filter(Boolean).join(", ")}</Text>}
        <Text style={typography.caption}>{t("Delivers to {pincode}", { pincode })}</Text>
        <Text style={[typography.title1, styles.price]}>{translatedPrice}</Text>
        <Text style={[typography.caption, !product.purchasable && styles.unavailable]}>{localizeCustomerMessage(status, t)}</Text>
        {!!product.description && <Text style={[typography.body, styles.description]}>{product.description}</Text>}

        <View style={styles.options}>
          <Text style={typography.title3}>{variants.length > 1 ? t("Choose an option") : t("Selling option")}</Text>
          {variants.length === 0 && <Text style={typography.body}>{t("No selling options are currently available.")}</Text>}
          {variants.map(variant => {
            const available = orderingAvailable && canPurchaseVariant(product, variant);
            const checked = selected?.id === variant.id;
            const label = formatVariantName(variant.quantityValue, variant.quantityUnit);
            const availability = localizeCustomerMessage(variantAvailabilityLabel(product, variant), t);
            return (
              <Pressable key={variant.id} accessibilityRole="radio"
                accessibilityLabel={t("{variant} · ₹{price} · {availability}{selected}", { variant: label, price: formatPrice(variant.price), availability: orderingAvailable ? availability : t("Store currently closed"), selected: checked ? ` · ${t("Selected")}` : "" })}
                accessibilityState={{ checked, disabled: !available || busy }}
                disabled={!available || busy} onPress={() => onSelect(variant)}
                style={[styles.option, checked && styles.selectedOption, !available && styles.disabledOption]}>
                <View style={[styles.radio, checked && styles.selectedRadio]}>{checked && <View style={styles.radioDot} />}</View>
                <View style={styles.optionContent}>
                  <View style={styles.optionHeading}>
                    <Text style={[typography.bodySemibold, styles.optionName]}>{label}</Text>
                    <Text style={[typography.bodySemibold, styles.optionPrice]}>₹{formatPrice(variant.price)}</Text>
                  </View>
                   <Text style={[typography.caption, !orderingAvailable && styles.unavailable]}>{!orderingAvailable ? t("Store currently closed") : availability}{checked ? ` · ${t("Selected")}` : ""}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        {purchasable && selected && (
          <View style={styles.selection}>
            <Text style={typography.bodySemibold}>{t("Selected: {variant} — ₹{price}", { variant: formatVariantName(selected.quantityValue, selected.quantityUnit), price: formatPrice(selected.price) })}</Text>
            <View style={styles.quantity}>
              <View style={styles.quantityLabel}>
                <Text style={typography.title3}>{t("Order quantity")}</Text>
                <Text style={typography.caption}>{quantity} × {formatVariantName(selected.quantityValue, selected.quantityUnit)}</Text>
              </View>
              <QuantitySelector quantity={quantity} min={1} disabled={busy}
                onDecrease={() => onQuantityChange(Math.max(1, quantity - 1))}
                onIncrease={() => onQuantityChange(Math.min(999, quantity + 1))} />
            </View>
          </View>
        )}
        {!!error && <Text accessibilityRole="alert" style={[typography.body, styles.unavailable, styles.error]}>{localizeCustomerMessage(error, t)}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel={busy ? t("Adding to cart") : addLabel}
          accessibilityState={{ disabled: !purchasable || busy, busy }}
          disabled={!purchasable || busy} onPress={() => selected && onAdd(selected)}
          style={[styles.addButton, (!purchasable || busy) && styles.disabledOption]}>
          {busy ? <ActivityIndicator color={colors.card} /> : <Text style={styles.addText}>{addLabel}</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.navigation}>
          <Text style={styles.link}>{t("Continue shopping")}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  cartClearance: { paddingBottom: 192 },
  navigation: { minHeight: 44, justifyContent: "center", paddingVertical: spacing.sm, marginVertical: spacing.sm },
  link: { ...typography.bodySemibold, color: colors.accent },
  hero: { marginBottom: spacing.lg, width: "100%" },
  image: { width: "100%", aspectRatio: 1.5, maxHeight: 320, borderRadius: radius.xl, backgroundColor: colors.card },
  store: { marginTop: spacing.sm },
  price: { color: colors.accent, marginTop: spacing.sm },
  description: { marginTop: spacing.md },
  unavailable: { color: colors.danger },
  options: { marginVertical: spacing.lg, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, backgroundColor: colors.card },
  option: { minHeight: 64, flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md },
  selectedOption: { borderColor: colors.accent, backgroundColor: colors.soft, borderWidth: 2 },
  optionContent: { flex: 1, minWidth: 0, gap: spacing.xs },
  optionHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm },
  optionName: { flexShrink: 1 },
  optionPrice: { color: colors.accent, flexShrink: 1 },
  radio: { width: 20, height: 20, flexShrink: 0, marginTop: 2, borderWidth: 2, borderRadius: radius.full, borderColor: colors.muted, alignItems: "center", justifyContent: "center" },
  selectedRadio: { borderColor: colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: radius.full, backgroundColor: colors.accent },
  selection: { backgroundColor: colors.card, padding: spacing.md, gap: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, marginBottom: spacing.lg },
  quantity: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  quantityLabel: { minWidth: 140, flexGrow: 1, flexShrink: 1 },
  error: { marginBottom: spacing.md },
  closedNotice: { padding: spacing.md, marginTop: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.soft, gap: spacing.xs },
  closedTitle: { ...typography.bodySemibold, color: colors.danger },
  closedCopy: { ...typography.caption, color: colors.ink },
  addButton: { backgroundColor: colors.accent, borderRadius: radius.md, padding: spacing.md, minHeight: 52, alignItems: "center", justifyContent: "center" },
  addText: { ...typography.bodySemibold, color: colors.card, textAlign: "center" },
  disabledOption: { opacity: 0.55 },
});