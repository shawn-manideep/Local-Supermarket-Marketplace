import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { formatPrice, formatVariantName } from "@workspace/validation/variant-formatting";
import type { CustomerProduct, CustomerProductVariant, CustomerStore } from "../lib/api";
import { activeVariants, canPurchaseVariant, productAvailabilityLabel, productPriceLabel, variantAvailabilityLabel } from "../lib/shopping";
import { colors, commonStyles, radius, spacing, typography } from "../theme";
import { PlaceholderImage } from "./PlaceholderImage";
import { QuantitySelector } from "./QuantitySelector";

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
}

export function ShoppingProductDetails({
  product, store, pincode, selectedVariantId, quantity, busy, hasCart, error, backLabel,
  onBack, onSelect, onQuantityChange, onAdd,
}: Props) {
  const variants = activeVariants(product);
  const selected = variants.find(variant => variant.id === selectedVariantId);
  const purchasable = !!selected && canPurchaseVariant(product, selected);
  const status = productAvailabilityLabel(product);
  const needsChoice = !selected && variants.some(variant => canPurchaseVariant(product, variant));
  const addLabel = purchasable ? `Add ${quantity} to Cart`
    : needsChoice ? "Choose an option first" : selected ? variantAvailabilityLabel(product, selected) : status;
  return (
    <ScrollView contentContainerStyle={[commonStyles.page, hasCart && styles.cartClearance]}>
      <View style={commonStyles.container}>
        <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} style={styles.navigation}>
          <Text style={styles.link}>← {backLabel}</Text>
        </Pressable>
        <View style={styles.hero}>
          {product.imageUrl ? <Image source={{ uri: product.imageUrl }} style={styles.image} resizeMode="contain" />
            : <PlaceholderImage name={product.name} style={styles.image} />}
        </View>
        <Text style={typography.hero}>{product.name}</Text>
        {!!product.brand && <Text style={typography.bodySemibold}>{product.brand}</Text>}
        <Text style={[typography.bodySemibold, styles.store]}>Sold by {store.name}</Text>
        <Text style={typography.caption}>Delivers to {pincode}</Text>
        <Text style={[typography.title1, styles.price]}>{productPriceLabel(product, selected)}</Text>
        <Text style={[typography.caption, !product.purchasable && styles.unavailable]}>{status}</Text>
        {!!product.description && <Text style={[typography.body, styles.description]}>{product.description}</Text>}

        <View style={styles.options}>
          <Text style={typography.title3}>{variants.length > 1 ? "Choose an option" : "Selling option"}</Text>
          {variants.length === 0 && <Text style={typography.body}>No selling options are currently available.</Text>}
          {variants.map(variant => {
            const available = canPurchaseVariant(product, variant);
            const checked = selected?.id === variant.id;
            const label = formatVariantName(variant.quantityValue, variant.quantityUnit);
            const availability = variantAvailabilityLabel(product, variant);
            return (
              <Pressable key={variant.id} accessibilityRole="radio"
                accessibilityLabel={`${label} · ₹${formatPrice(variant.price)} · ${availability}${checked ? " · Selected" : ""}`}
                accessibilityState={{ checked, disabled: !available || busy }}
                disabled={!available || busy} onPress={() => onSelect(variant)}
                style={[styles.option, checked && styles.selectedOption, !available && styles.disabledOption]}>
                <View style={[styles.radio, checked && styles.selectedRadio]}>{checked && <View style={styles.radioDot} />}</View>
                <View style={styles.optionContent}>
                  <View style={styles.optionHeading}>
                    <Text style={[typography.bodySemibold, styles.optionName]}>{label}</Text>
                    <Text style={[typography.bodySemibold, styles.optionPrice]}>₹{formatPrice(variant.price)}</Text>
                  </View>
                  <Text style={[typography.caption, !available && styles.unavailable]}>{availability}{checked ? " · Selected" : ""}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        {purchasable && selected && (
          <View style={styles.selection}>
            <Text style={typography.bodySemibold}>Selected: {formatVariantName(selected.quantityValue, selected.quantityUnit)} — ₹{formatPrice(selected.price)}</Text>
            <View style={styles.quantity}>
              <View style={styles.quantityLabel}>
                <Text style={typography.title3}>Order quantity</Text>
                <Text style={typography.caption}>{quantity} × {formatVariantName(selected.quantityValue, selected.quantityUnit)}</Text>
              </View>
              <QuantitySelector quantity={quantity} min={1} disabled={busy}
                onDecrease={() => onQuantityChange(Math.max(1, quantity - 1))}
                onIncrease={() => onQuantityChange(Math.min(999, quantity + 1))} />
            </View>
          </View>
        )}
        {!!error && <Text accessibilityRole="alert" style={[typography.body, styles.unavailable, styles.error]}>{error}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel={busy ? "Adding to cart" : addLabel}
          accessibilityState={{ disabled: !purchasable || busy, busy }}
          disabled={!purchasable || busy} onPress={() => selected && onAdd(selected)}
          style={[styles.addButton, (!purchasable || busy) && styles.disabledOption]}>
          {busy ? <ActivityIndicator color={colors.card} /> : <Text style={styles.addText}>{addLabel}</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.navigation}>
          <Text style={styles.link}>Continue shopping</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  cartClearance: { paddingBottom: 192 },
  navigation: { minHeight: 44, justifyContent: "center", paddingVertical: spacing.sm, marginVertical: spacing.sm },
  link: { ...typography.bodySemibold, color: colors.accent },
  hero: { marginBottom: spacing.lg },
  image: { width: "100%", aspectRatio: 1.5, borderRadius: radius.xl, backgroundColor: colors.card },
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
  addButton: { backgroundColor: colors.accent, borderRadius: radius.md, padding: spacing.md, minHeight: 48, alignItems: "center", justifyContent: "center" },
  addText: { ...typography.bodySemibold, color: colors.card, textAlign: "center" },
  disabledOption: { opacity: 0.55 },
});