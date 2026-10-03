import { useEffect, useRef, useState } from "react";
import { formatVariantName, formatPrice } from "@workspace/validation/variant-formatting";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { customerApi, CustomerRequestError, type CustomerAddress, type CustomerCart, type CustomerCheckoutSubmission } from "./lib/api";
import { colors, radius, spacing, typography, commonStyles, shadows } from "./theme";
import { QuantitySelector } from "./components/QuantitySelector";
import { ConfirmationDialog } from "./components/ConfirmationDialog";
import { PlaceholderImage } from "./components/PlaceholderImage";
import { shoppingError } from "./lib/shopping";

function BasketIcon() {
  return (
    <View style={{ width: 40, height: 32, borderBottomWidth: 3, borderLeftWidth: 3, borderRightWidth: 3, borderColor: colors.muted, borderRadius: 4, position: "relative", alignItems: "center", marginTop: 12 }}>
      <View style={{ width: 24, height: 16, borderTopWidth: 3, borderLeftWidth: 3, borderRightWidth: 3, borderColor: colors.muted, position: "absolute", top: -16, borderTopLeftRadius: 12, borderTopRightRadius: 12 }} />
    </View>
  );
}

export function CartScreen({ openAddresses, onOrderPlaced, continueShopping }: { openAddresses: () => void; onOrderPlaced: (orderId: string) => void; continueShopping: () => void }) {
  const [cart, setCart] = useState<CustomerCart | null>(null);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [addressId, setAddressId] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const quantityQueues = useRef<Record<string, { target: number; running: boolean }>>({});
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const checkoutInFlight = useRef(false);

  const [clearDialogVisible, setClearDialogVisible] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);

  const load = async () => {
    setLoading(true); setMessage("");
    try {
      const [cartResult, addressResult] = await Promise.all([
        customerApi<{ cart: CustomerCart | null }>("/api/customer/cart"),
        customerApi<{ addresses: CustomerAddress[] }>("/api/customer/addresses"),
      ]);
      setCart(cartResult.cart); setAddresses(addressResult.addresses);
      const selected = addressResult.addresses.find((address) => address.isDefault) ?? addressResult.addresses[0];
      if (selected) setAddressId(selected.id);
    } catch (reason) { setMessage(shoppingError(reason, "Unable to load your cart. Please try again.")); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const quantity = (itemId: string, next: number) => {
    const current = cart?.items.find((item) => item.id === itemId)?.quantity ?? next;
    const queue = quantityQueues.current[itemId] ?? { target: current, running: false };
    if (queue.target === 0) {
      if (next === 0) return;
    }
    queue.target = next === 0 ? 0 : Math.max(1, queue.target + (next - current));
    quantityQueues.current[itemId] = queue;
    if (!queue.running) void flushQuantity(itemId);
  };
  
  const flushQuantity = async (itemId: string) => {
    const queue = quantityQueues.current[itemId];
    if (!queue || queue.running) return;
    queue.running = true;
    try {
      while (true) {
        const sentTarget = queue.target;
        const result = await customerApi<{ cart: CustomerCart }>(`/api/customer/cart/items/${itemId}`, { method:"PATCH", body:JSON.stringify({ quantity:sentTarget }) });
        setCart(result.cart);
        if (queue.target === sentTarget) break;
      }
    } catch (reason) {
      setMessage(shoppingError(reason, "Unable to update your cart. Please try again."));
    } finally {
      delete quantityQueues.current[itemId];
    }
  };

  const clear = () => setClearDialogVisible(true);

  const confirmClear = async () => {
    setClearLoading(true);
    try {
      await customerApi("/api/customer/cart", { method: "DELETE" });
      setCart(null);
    } catch (reason) {
      setMessage(shoppingError(reason, "Unable to clear your basket. Please try again."));
    } finally {
      setClearLoading(false);
      setClearDialogVisible(false);
    }
  };

  const validate = async () => {
    if (checkoutInFlight.current || checkoutBusy || !cart || !addressId) { if (!addressId) setMessage("Select or add a delivery address."); return; }
    if (Object.values(quantityQueues.current).some(queue => queue.running)) {
      setMessage("Please wait for your quantity changes to finish before placing the order.");
      return;
    }
    checkoutInFlight.current = true;
    setCheckoutBusy(true);
    setMessage("");
    try {
      // The cart's UUID is a stable checkout key across retries and reloads.
      // Do not prevalidate here: a retry must reach the server's replay check even
      // when the original successful transaction has already converted the cart.
      const input: CustomerCheckoutSubmission = { cartId: cart.id, idempotencyKey: cart.id, addressId, paymentMethod: "COD" };
      const result = await customerApi<{ order: { id: string } }>("/api/customer/orders", { method:"POST", body:JSON.stringify(input) });
      onOrderPlaced(result.order.id);
    } catch (reason) {
      setMessage(shoppingError(reason, "Unable to place your order. Please review your cart or try again."));
      if (reason instanceof CustomerRequestError && ["OUT_OF_STOCK", "INSUFFICIENT_STOCK", "VARIANT_UNAVAILABLE", "INVALID_QUANTITY"].includes(reason.code ?? "")) {
        try {
          const refreshed = await customerApi<{ cart: CustomerCart | null }>("/api/customer/cart");
          setCart(refreshed.cart);
        } catch { /* Retain the visible cart and original checkout error for retry. */ }
      }
      // An uncertain network failure retains this cart and its stable key.
      // Retrying can recover a committed order instead of placing another one.
    }
    finally { checkoutInFlight.current = false; setCheckoutBusy(false); }
  };

  if (loading) return <View style={[commonStyles.page, styles.center]}><ActivityIndicator color={colors.accent}/></View>;
  
  if (!cart) return (
    <ScrollView contentContainerStyle={commonStyles.page}>
      <View style={[commonStyles.container, { flex: 1, justifyContent: "center", alignItems: "center", gap: spacing.lg }]}>
        <Text style={styles.emptyHeader}>My Cart</Text>
        <View style={styles.emptyBasket}>
          <BasketIcon />
        </View>
        <Text style={typography.title1}>Your basket is empty</Text>
        <Text style={[typography.body, { textAlign: "center" }]}>Add fresh groceries from a local supermarket to get started.</Text>
        {!!message && <Text style={[typography.caption, { color: colors.danger }]}>{message}</Text>}
        <Pressable accessibilityRole="button" onPress={continueShopping} style={styles.primaryBtn}><Text style={styles.primaryBtnText}>Continue shopping</Text></Pressable>
        {!!message && <Pressable accessibilityRole="button" onPress={() => void load()}><Text style={typography.bodySemibold}>Try again</Text></Pressable>}
      </View>
    </ScrollView>
  );

  return (
    <>
      <ScrollView contentContainerStyle={commonStyles.page}>
        <View style={commonStyles.container}>
          <Pressable accessibilityRole="button" onPress={continueShopping} style={{ marginBottom: spacing.md }}><Text style={[typography.bodySemibold, { color: colors.accent }]}>← Continue shopping</Text></Pressable>
          <View style={styles.cartHeader}><Text style={styles.cartHeaderText}>My Cart</Text><Pressable accessibilityRole="button" onPress={clear}><Text style={styles.clearText}>Clear</Text></Pressable></View>
          <Text style={[typography.caption, { marginBottom: spacing.md }]}>{cart.items.length} {cart.items.length === 1 ? "item" : "items"} · {cart.storeName}</Text>
          
          <View style={{ gap: spacing.md, marginBottom: spacing.xl }}>
            {cart.items.map((item) => (
              <View key={item.id} style={styles.cartItem}>
                {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.cartImage} /> : <PlaceholderImage name={item.name} style={styles.cartImage} />}
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Text style={typography.bodySemibold}>{item.name}</Text>
                  <Text style={[typography.caption, { color: colors.accent, fontWeight: "700" }]}>{formatVariantName(item.quantityValue, item.quantityUnit)}</Text>
                  <Text style={typography.caption}>₹{formatPrice(item.unitPrice)} each</Text>
                  <Text style={typography.caption}>Qty: {item.quantity} × {formatVariantName(item.quantityValue, item.quantityUnit)}</Text>
                  <QuantitySelector quantity={item.quantity} onDecrease={() => quantity(item.id, item.quantity - 1)} onIncrease={() => quantity(item.id, item.quantity + 1)} min={1} />
                  {!item.purchasable && <Text style={[typography.caption, { color: colors.danger }]}>{item.unavailableReason === "OUT_OF_STOCK" ? "Out of stock" : item.unavailableReason === "INSUFFICIENT_STOCK" ? "No longer available in the selected quantity. Please reduce the quantity." : "This item is no longer available."}</Text>}
                </View>
                <View style={{ alignItems: "flex-end", gap: spacing.sm }}>
                  <Text style={typography.title3}>₹{formatPrice(item.lineSubtotal)}</Text>
                  <Pressable onPress={() => quantity(item.id, 0)} hitSlop={10}><Text style={[typography.caption, { color: colors.danger, fontWeight: "600" }]}>Remove</Text></Pressable>
                </View>
              </View>
            ))}
          </View>

          <View style={commonStyles.card}>
            <Line label="Subtotal" value={cart.subtotal} />
            <Line label="Delivery fee" value={cart.deliveryFee} />
            <Text style={[typography.caption, { marginVertical: 4 }]}>Minimum order ₹{cart.minimumOrderValue}</Text>
            <View style={styles.divider} />
            <Line label="Total" value={cart.total} strong />
          </View>

          <Text style={[typography.title2, { marginTop: spacing.xl, marginBottom: spacing.md }]}>Delivery Address</Text>
          {addresses.length === 0 ? (
            <Pressable onPress={openAddresses} style={styles.secondaryBtn}><Text style={styles.secondaryBtnText}>Add Delivery Address</Text></Pressable>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {addresses.map((address) => (
                <Pressable key={address.id} accessibilityRole="radio" accessibilityState={{ selected: addressId === address.id }} onPress={() => setAddressId(address.id)} style={[styles.addressCard, addressId === address.id && styles.addressCardActive]}>
                  <View style={[styles.radio, addressId === address.id && styles.radioActive]}>
                    {addressId === address.id && <View style={styles.radioInner} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={typography.bodySemibold}>{address.label ?? address.recipientName}</Text>
                    <Text style={typography.body}>{address.line1}, {address.city} {address.pincode}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          <Text style={[typography.title2, { marginTop: spacing.xl, marginBottom: spacing.md }]}>Payment Method</Text>
          <View style={[commonStyles.card, { flexDirection: "row", alignItems: "center", gap: spacing.sm }]}>
            <View style={styles.radioActive}><View style={styles.radioInner} /></View>
            <Text style={typography.bodySemibold}>Cash on Delivery (COD)</Text>
          </View>

          <View style={{ marginTop: spacing.xxl, gap: spacing.md }}>
            {!cart.checkoutReady && <Text style={[typography.caption, { color: colors.danger, textAlign: "center" }]}>Resolve unavailable items or meet the minimum order value to checkout.</Text>}
            {!!message && <Text style={[typography.caption, { color: colors.danger, textAlign: "center" }]}>{message}</Text>}
            
            <Pressable accessibilityRole="button" disabled={!cart.checkoutReady || !addressId || checkoutBusy} onPress={validate} style={[styles.primaryBtn, (!cart.checkoutReady || !addressId || checkoutBusy) && styles.disabled]}>
              {checkoutBusy ? <ActivityIndicator color={colors.card} /> : <Text style={styles.primaryBtnText}>Place Order • ₹{cart.total}</Text>}
            </Pressable>
          </View>
        </View>
      </ScrollView>
      <ConfirmationDialog
        visible={clearDialogVisible}
        title="Clear Basket?"
        message="The basket record will be preserved as abandoned. Are you sure?"
        confirmLabel="Clear"
        isDestructive
        loading={clearLoading}
        onConfirm={confirmClear}
        onCancel={() => !clearLoading && setClearDialogVisible(false)}
      />
    </>
  );
}

function Line({label,value,strong=false}:{label:string;value:string;strong?:boolean}) { 
  return (
    <View style={styles.between}>
      <Text style={strong ? typography.title3 : typography.body}>{label}</Text>
      <Text style={strong ? typography.title3 : typography.bodySemibold}>₹{value}</Text>
    </View>
  ); 
}

const styles = StyleSheet.create({
  emptyHeader: { position: "absolute", top: 0, left: 0, right: 0, backgroundColor: colors.accent, color: colors.card, fontSize: 20, fontWeight: "800", padding: spacing.lg },
  center: { alignItems: "center", justifyContent: "center" },
  emptyBasket: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  cartItem: { flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: spacing.md, ...shadows.sm },
  cartImage: { width: 64, height: 64, borderRadius: radius.md },
  cartHeader: { backgroundColor: colors.accent, marginHorizontal: -spacing.lg, marginTop: -16, paddingHorizontal: spacing.lg, height: 60, marginBottom: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cartHeaderText: { color: colors.card, fontSize: 20, fontWeight: "800" },
  clearText: { color: colors.card, fontWeight: "600" },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: 4 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: spacing.sm },
  secondaryBtn: { backgroundColor: colors.soft, borderRadius: radius.md, height: 52, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: colors.line },
  secondaryBtnText: { ...typography.bodySemibold, color: colors.ink },
  primaryBtn: { backgroundColor: colors.accent, borderRadius: radius.md, height: 56, justifyContent: "center", alignItems: "center" },
  primaryBtnText: { ...typography.title3, color: colors.card },
  disabled: { opacity: 0.4 },
  addressCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: spacing.md },
  addressCardActive: { borderColor: colors.ink, backgroundColor: colors.soft },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.muted, justifyContent: "center", alignItems: "center" },
  radioActive: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.ink, justifyContent: "center", alignItems: "center" },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ink },
});