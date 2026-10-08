import { useEffect, useRef, useState } from "react";
import { formatVariantName, formatPrice } from "@workspace/validation/variant-formatting";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { CustomerText as Text } from "./components/CustomerTypography";
import { customerApi, CustomerRequestError, type CustomerAddress, type CustomerCart, type CustomerCheckoutSubmission, type CustomerDeliveryMode, type CustomerDeliverySlot, type CustomerDeliverySlotsResponse } from "./lib/api";
import { colors, fontWeights, radius, spacing, typography, commonStyles, shadows } from "./theme";
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

export function CartScreen({ openAddresses, onOrderPlaced, continueShopping }: { openAddresses: () => void; onOrderPlaced: (orderId: string) => void; continueShopping: (storeId?: string) => void }) {
  const [cart, setCart] = useState<CustomerCart | null>(null);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [addressId, setAddressId] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const quantityQueues = useRef<Record<string, { target: number; running: boolean }>>({});
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const checkoutInFlight = useRef(false);
  const [deliveryMode, setDeliveryMode] = useState<CustomerDeliveryMode>("INSTANT");
  const [slotResponse, setSlotResponse] = useState<CustomerDeliverySlotsResponse | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<CustomerDeliverySlot | null>(null);
  const [selectedDay, setSelectedDay] = useState("");
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [slotRefresh, setSlotRefresh] = useState(0);
  const checkoutIntent = useRef<{ cartId: string; addressId: string; mode: CustomerDeliveryMode; startAt: string; endAt: string; key: string } | null>(null);
  const checkoutChoiceChanged = useRef(false);

  const [clearDialogVisible, setClearDialogVisible] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);

  const load = async () => {
    setLoading(true); setMessage(""); setLoadFailed(false);
    setDeliveryMode("INSTANT"); setSelectedSlot(null); setSelectedDay(""); setSlotResponse(null); setSlotsError("");
    checkoutIntent.current = null;
    checkoutChoiceChanged.current = false;
    setSlotRefresh(value => value + 1);
    try {
      const [cartResult, addressResult] = await Promise.all([
        customerApi<{ cart: CustomerCart | null }>("/api/customer/cart"),
        customerApi<{ addresses: CustomerAddress[] }>("/api/customer/addresses"),
      ]);
      setCart(cartResult.cart); setAddresses(addressResult.addresses);
      const selected = addressResult.addresses.find((address) => address.isDefault) ?? addressResult.addresses[0];
      if (selected) setAddressId(selected.id);
    } catch (reason) { setLoadFailed(true); setMessage(shoppingError(reason, "Unable to load your cart. Please try again.")); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const selectedAddress = addresses.find(address => address.id === addressId);
  useEffect(() => {
    setSelectedSlot(null);
    setSelectedDay("");
    setSlotResponse(null);
    setSlotsError("");
    if (deliveryMode !== "SCHEDULED" || !cart || !selectedAddress?.pincode) {
      setSlotsLoading(false);
      return;
    }
    let active = true;
    setSlotsLoading(true);
    const query = new URLSearchParams({ pincode: selectedAddress.pincode });
    customerApi<CustomerDeliverySlotsResponse>(`/api/customer/stores/${encodeURIComponent(cart.storeId)}/delivery-slots?${query}`)
      .then(result => {
        if (!active) return;
        setSlotResponse(result);
        const firstDay = result.slots.length ? indiaDayKey(result.slots[0].startAt) : "";
        setSelectedDay(firstDay);
      })
      .catch(reason => { if (active) setSlotsError(shoppingError(reason, "Available delivery times could not be loaded.")); })
      .finally(() => { if (active) setSlotsLoading(false); });
    return () => { active = false; };
  }, [deliveryMode, cart?.storeId, selectedAddress?.pincode, slotRefresh]);

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
    if (cart.operatingStatus === "CLOSED") {
      setMessage("This store is currently closed and cannot accept orders. Your cart has been kept.");
      return;
    }
    if (deliveryMode === "SCHEDULED" && (!selectedSlot || slotsLoading || slotResponse?.operatingStatus !== "OPEN")) {
      setMessage("Choose an available delivery time before placing your order.");
      return;
    }
    if (Object.values(quantityQueues.current).some(queue => queue.running)) {
      setMessage("Please wait for your quantity changes to finish before placing the order.");
      return;
    }
    checkoutInFlight.current = true;
    setCheckoutBusy(true);
    setMessage("");
    try {
      // Keep a stable key for retries of the exact same intent, including after
      // a reload. Instant retains the legacy cart UUID until the customer changes
      // the delivery intent; each changed mode/address/window derives a new key.
      // Do not prevalidate stock here: retries must reach the server replay check.
      const startAt = deliveryMode === "SCHEDULED" ? selectedSlot?.startAt ?? "" : "";
      const endAt = deliveryMode === "SCHEDULED" ? selectedSlot?.endAt ?? "" : "";
      let intent = checkoutIntent.current;
      if (!intent || intent.cartId !== cart.id || intent.addressId !== addressId ||
        intent.mode !== deliveryMode || intent.startAt !== startAt || intent.endAt !== endAt) {
        const firstInstantIntent = !intent && !checkoutChoiceChanged.current && deliveryMode === "INSTANT";
        intent = {
          cartId: cart.id, addressId, mode: deliveryMode, startAt, endAt,
          key: firstInstantIntent ? cart.id : stableCheckoutKey(cart.id, addressId, deliveryMode, startAt, endAt),
        };
        checkoutIntent.current = intent;
      }
      const input: CustomerCheckoutSubmission = {
        cartId: cart.id, idempotencyKey: intent.key, addressId, paymentMethod: "COD", deliveryMode,
        ...(deliveryMode === "SCHEDULED" && selectedSlot
          ? { scheduledStartAt: selectedSlot.startAt, scheduledEndAt: selectedSlot.endAt }
          : {}),
      };
      const result = await customerApi<{ order: { id: string } }>("/api/customer/orders", { method:"POST", body:JSON.stringify(input) });
      onOrderPlaced(result.order.id);
    } catch (reason) {
      if (reason instanceof CustomerRequestError && reason.code === "STORE_CLOSED") {
        setCart(current => current ? { ...current, operatingStatus: "CLOSED" } : current);
        setMessage("This store is currently closed and cannot accept orders. Your cart has been kept.");
      } else setMessage(shoppingError(reason, "Unable to place your order. Please review your cart or try again."));
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
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={commonStyles.page}>
      <View style={[commonStyles.container, { flex: 1, justifyContent: "center", alignItems: "center", gap: spacing.lg }]}>
        <Text style={styles.emptyHeader}>My Cart</Text>
        {!loadFailed && <View style={styles.emptyBasket}><BasketIcon /></View>}
        <Text style={typography.title1}>{loadFailed ? "Basket unavailable" : "Your basket is empty"}</Text>
        {!loadFailed && <Text style={[typography.body, { textAlign: "center" }]}>Add fresh groceries from a local supermarket to get started.</Text>}
        {!!message && <Text style={[typography.caption, { color: colors.danger }]}>{message}</Text>}
        <Pressable accessibilityRole="button" onPress={() => continueShopping()} style={styles.primaryBtn}><Text style={styles.primaryBtnText}>Continue shopping</Text></Pressable>
        {loadFailed && <Pressable accessibilityRole="button" onPress={() => void load()}><Text style={typography.bodySemibold}>Try again</Text></Pressable>}
      </View>
    </ScrollView>
  );

  return (
    <>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={commonStyles.page}>
        <View style={commonStyles.container}>
          <Pressable accessibilityRole="button" onPress={() => continueShopping(cart.storeId)} style={{ marginBottom: spacing.md }}><Text style={[typography.bodySemibold, { color: colors.accent }]}>← Continue shopping</Text></Pressable>
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
                <Pressable key={address.id} accessibilityRole="radio" accessibilityState={{ selected: addressId === address.id }} onPress={() => {
                  if (address.id !== addressId) {
                    setAddressId(address.id);
                    setSelectedSlot(null);
                    setSelectedDay("");
                    setSlotResponse(null);
                    setSlotsError("");
                    checkoutIntent.current = null;
                    checkoutChoiceChanged.current = true;
                  }
                }} style={[styles.addressCard, addressId === address.id && styles.addressCardActive]}>
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

          <Text style={[typography.title2, { marginTop: spacing.xl, marginBottom: spacing.md }]}>Delivery Option</Text>
          <View style={{ gap: spacing.sm }}>
            <Pressable accessibilityRole="radio" accessibilityState={{ selected: deliveryMode === "INSTANT" }} onPress={() => {
              if (deliveryMode !== "INSTANT") {
                setDeliveryMode("INSTANT"); setSelectedSlot(null); setSelectedDay(""); checkoutIntent.current = null; checkoutChoiceChanged.current = true;
              }
            }} style={[styles.deliveryChoice, deliveryMode === "INSTANT" && styles.deliveryChoiceActive]}>
              <View style={[styles.radio, deliveryMode === "INSTANT" && styles.radioActive]}>{deliveryMode === "INSTANT" && <View style={styles.radioInner} />}</View>
              <View style={{ flex: 1 }}><Text style={typography.bodySemibold}>Instant Delivery</Text><Text style={typography.caption}>Deliver as soon as possible</Text></View>
            </Pressable>
            <Pressable accessibilityRole="radio" accessibilityState={{ selected: deliveryMode === "SCHEDULED" }} onPress={() => {
              if (deliveryMode !== "SCHEDULED") {
                setDeliveryMode("SCHEDULED"); setSelectedSlot(null); setSelectedDay(""); setSlotResponse(null); setSlotsError(""); checkoutIntent.current = null; checkoutChoiceChanged.current = true;
              }
            }} style={[styles.deliveryChoice, deliveryMode === "SCHEDULED" && styles.deliveryChoiceActive]}>
              <View style={[styles.radio, deliveryMode === "SCHEDULED" && styles.radioActive]}>{deliveryMode === "SCHEDULED" && <View style={styles.radioInner} />}</View>
              <View style={{ flex: 1 }}><Text style={typography.bodySemibold}>Scheduled Delivery</Text><Text style={typography.caption}>Choose an available time</Text></View>
            </Pressable>
          </View>
          {deliveryMode === "SCHEDULED" && (
            <View style={[commonStyles.card, { marginTop: spacing.md, gap: spacing.md }]}>
              <View style={styles.between}>
                <Text style={typography.bodySemibold}>Available delivery times</Text>
                <Pressable accessibilityRole="button" disabled={slotsLoading} onPress={() => {
                  setSelectedSlot(null); setSelectedDay(""); setSlotResponse(null); setSlotsError("");
                  checkoutIntent.current = null; checkoutChoiceChanged.current = true;
                  setSlotRefresh(value => value + 1);
                }} style={slotsLoading && styles.disabled}>
                  <Text style={[typography.caption, { color: colors.accent, fontWeight: fontWeights.semibold }]}>Refresh</Text>
                </Pressable>
              </View>
              {slotsLoading ? <View style={styles.slotLoading}><ActivityIndicator color={colors.accent} /><Text style={typography.caption}>Checking store availability…</Text></View> : null}
              {!!slotsError && !slotsLoading && <View style={{ gap: spacing.sm }}>
                <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger }]}>{slotsError}</Text>
                <Pressable accessibilityRole="button" onPress={() => {
                  setSelectedSlot(null); checkoutIntent.current = null; checkoutChoiceChanged.current = true;
                  setSlotRefresh(value => value + 1);
                }} style={styles.secondaryBtn}><Text style={styles.secondaryBtnText}>Try again</Text></Pressable>
              </View>}
              {!slotsLoading && !slotsError && slotResponse?.operatingStatus === "CLOSED" && <Text style={[typography.body, { color: colors.danger }]}>Currently Closed. This store is not accepting orders.</Text>}
              {!slotsLoading && !slotsError && slotResponse?.operatingStatus === "OPEN" && slotResponse.slots.length === 0 && <Text style={typography.caption}>No delivery times are available right now. Refresh to check again.</Text>}
              {!slotsLoading && !slotsError && slotResponse?.operatingStatus === "OPEN" && slotResponse.slots.length > 0 && <>
                <View style={styles.slotDays}>
                  {availableDays(slotResponse.slots).map(day => <Pressable key={day} accessibilityRole="button" accessibilityState={{ selected: selectedDay === day }} onPress={() => {
                    if (day !== selectedDay) { setSelectedDay(day); setSelectedSlot(null); checkoutIntent.current = null; checkoutChoiceChanged.current = true; }
                  }} style={[styles.dayChip, selectedDay === day && styles.dayChipActive]}>
                    <Text style={[styles.dayChipText, selectedDay === day && styles.dayChipTextActive]}>{dayLabel(day)}</Text>
                  </Pressable>)}
                </View>
                <View style={styles.slotTimes}>
                  {slotResponse.slots.filter(slot => indiaDayKey(slot.startAt) === selectedDay).map(slot => {
                    const chosen = selectedSlot?.startAt === slot.startAt && selectedSlot?.endAt === slot.endAt;
                    return <Pressable key={`${slot.startAt}-${slot.endAt}`} accessibilityRole="radio" accessibilityState={{ selected: chosen }} onPress={() => {
                      if (!chosen) {
                        setSelectedSlot(slot); checkoutIntent.current = null; checkoutChoiceChanged.current = true; setMessage("");
                      }
                    }} style={[styles.timeChip, chosen && styles.timeChipActive]}>
                      <Text style={[styles.timeChipText, chosen && styles.timeChipTextActive]}>{indiaTime(slot.startAt)} – {indiaTime(slot.endAt)}</Text>
                    </Pressable>;
                  })}
                </View>
                <Text style={typography.caption}>Times shown in India Standard Time (IST).</Text>
              </>}
            </View>
          )}

          <Text style={[typography.title2, { marginTop: spacing.xl, marginBottom: spacing.md }]}>Payment Method</Text>
          <View style={[commonStyles.card, { flexDirection: "row", alignItems: "center", gap: spacing.sm }]}>
            <View style={styles.radioActive}><View style={styles.radioInner} /></View>
            <Text style={typography.bodySemibold}>Cash on Delivery (COD)</Text>
          </View>

          <View style={{ marginTop: spacing.xxl, gap: spacing.md }}>
            {cart.operatingStatus === "CLOSED" && <View accessibilityRole="alert" style={styles.closedNotice}>
              <Text style={styles.closedNoticeTitle}>Currently Closed</Text>
              <Text style={typography.body}>This store is not accepting orders right now. Your cart is safe; try again when it reopens.</Text>
            </View>}
            {!cart.checkoutReady && <Text style={[typography.caption, { color: colors.danger, textAlign: "center" }]}>Resolve unavailable items or meet the minimum order value to checkout.</Text>}
            {!!message && <Text style={[typography.caption, { color: colors.danger, textAlign: "center" }]}>{message}</Text>}
            
            <Pressable accessibilityRole="button" disabled={!cart.checkoutReady || !addressId || checkoutBusy || cart.operatingStatus === "CLOSED" || (deliveryMode === "SCHEDULED" && (!selectedSlot || slotsLoading || !!slotsError || slotResponse?.operatingStatus !== "OPEN"))} onPress={validate} style={[styles.primaryBtn, (!cart.checkoutReady || !addressId || checkoutBusy || cart.operatingStatus === "CLOSED" || (deliveryMode === "SCHEDULED" && (!selectedSlot || slotsLoading || !!slotsError || slotResponse?.operatingStatus !== "OPEN"))) && styles.disabled]}>
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

function indiaDayKey(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function indiaTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(value));
}

function availableDays(slots: CustomerDeliverySlot[]) {
  return [...new Set(slots.map(slot => indiaDayKey(slot.startAt)))];
}

function stableCheckoutKey(cartId: string, addressId: string, mode: CustomerDeliveryMode, startAt: string, endAt: string) {
  const source = JSON.stringify([cartId, addressId, mode, startAt, endAt]);
  const seeds = [2166136261, 2246822519, 3266489917, 668265263];
  const primes = [16777619, 3266489917, 668265263, 374761393];
  const chunks = seeds.map((seed, index) => {
    let hash = seed;
    for (let position = 0; position < source.length; position += 1) {
      hash = Math.imul(hash ^ source.charCodeAt(position), primes[index]);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  });
  const raw = chunks.join("");
  const uuid = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-5${raw.slice(13, 16)}-a${raw.slice(17, 20)}-${raw.slice(20, 32)}`;
  return uuid;
}

function dayLabel(day: string) {
  const today = indiaDayKey(new Date().toISOString());
  const tomorrow = indiaDayKey(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
  if (day === today) return "Today";
  if (day === tomorrow) return "Tomorrow";
  const date = new Date(`${day}T12:00:00+05:30`);
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" }).format(date);
}

const styles = StyleSheet.create({
  emptyHeader: { position: "absolute", top: 0, left: 0, right: 0, backgroundColor: colors.accent, color: colors.card, fontSize: 20, fontWeight: fontWeights.bold, padding: spacing.lg },
  center: { alignItems: "center", justifyContent: "center" },
  emptyBasket: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  cartItem: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "flex-start", backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: spacing.md, ...shadows.sm },
  cartImage: { width: 60, height: 60, borderRadius: radius.md },
  cartHeader: { backgroundColor: colors.accent, marginHorizontal: -spacing.lg, marginTop: -16, paddingHorizontal: spacing.lg, height: 60, marginBottom: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cartHeaderText: { color: colors.card, fontSize: 20, fontWeight: fontWeights.semibold },
  clearText: { color: colors.card, fontWeight: fontWeights.semibold },
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
  deliveryChoice: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: spacing.md, minHeight: 68 },
  deliveryChoiceActive: { borderColor: colors.ink, backgroundColor: colors.soft },
  slotLoading: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
  slotDays: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  dayChip: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 42, justifyContent: "center" },
  dayChipActive: { borderColor: colors.accent, backgroundColor: colors.soft },
  dayChipText: { ...typography.caption, color: colors.ink, fontWeight: fontWeights.semibold },
  dayChipTextActive: { color: colors.accent },
  slotTimes: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  timeChip: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  timeChipActive: { borderColor: colors.accent, backgroundColor: colors.accent },
  timeChipText: { ...typography.caption, color: colors.ink, fontWeight: fontWeights.semibold },
  timeChipTextActive: { color: colors.card },
  closedNotice: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.highlight, borderWidth: 1, borderColor: colors.line, gap: spacing.xs },
  closedNoticeTitle: { ...typography.bodySemibold, color: colors.danger },
});