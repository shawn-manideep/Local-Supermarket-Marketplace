import { useEffect, useMemo, useRef, useState } from "react";
import { formatVariantName, formatPrice } from "@workspace/validation/variant-formatting";
import { ActivityIndicator, AppState, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { CustomerText as Text } from "./components/CustomerTypography";
import { customerApi, CustomerRequestError, type CustomerAddress, type CustomerCart, type CustomerCheckoutSubmission, type CustomerDeliveryMode, type CustomerDeliverySlot, type CustomerDeliverySlotsResponse } from "./lib/api";
import { colors, fontWeights, radius, spacing, typography, commonStyles, shadows } from "./theme";
import { QuantitySelector } from "./components/QuantitySelector";
import { ConfirmationDialog } from "./components/ConfirmationDialog";
import { PlaceholderImage } from "./components/PlaceholderImage";
import { shoppingError } from "./lib/shopping";
import { addressStreetLines } from "./lib/address-format";
import { createCartQuantityController, waitForCartQuantityWrites } from "./lib/cart-quantity";
import { isCustomerAppForeground, subscribeToCustomerForeground } from "./lib/app-lifecycle";
import { useTranslation, localizeCustomerMessage } from "@workspace/localization";
import { CustomerAddressFields } from "./components/CustomerAddressForm";
import { blankAddress, normalizeAddressInput, validateAddressInput } from "./lib/address-entry";
import type { AddressInput } from "./lib/api";

function BasketIcon() {
  return (
    <View style={{ width: 40, height: 32, borderBottomWidth: 3, borderLeftWidth: 3, borderRightWidth: 3, borderColor: colors.muted, borderRadius: 4, position: "relative", alignItems: "center", marginTop: 12 }}>
      <View style={{ width: 24, height: 16, borderTopWidth: 3, borderLeftWidth: 3, borderRightWidth: 3, borderColor: colors.muted, position: "absolute", top: -16, borderTopLeftRadius: 12, borderTopRightRadius: 12 }} />
    </View>
  );
}

export function CartScreen({ openAddresses, onOrderPlaced, continueShopping, onCartChange }: { openAddresses: () => void; onOrderPlaced: (orderId: string) => void; continueShopping: (storeId?: string) => void; onCartChange?: (cart: CustomerCart | null) => void }) {
  const { t, language } = useTranslation();
  const [cart, setCart] = useState<CustomerCart | null>(null);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [addressId, setAddressId] = useState("");
  const [addressModalVisible, setAddressModalVisible] = useState(false);
  const [addressDraft, setAddressDraft] = useState<AddressInput>(blankAddress);
  const [addressSaving, setAddressSaving] = useState(false);
  const [addressMessage, setAddressMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [quantityBusy, setQuantityBusy] = useState(false);
  const mounted = useRef(true);
  const publishedSummary = useRef<{ units: number; storeName: string } | null>(null);
  const hasPublishedSummary = useRef(false);
  const quantityController = useRef<ReturnType<typeof createCartQuantityController> | null>(null);
  if (!quantityController.current) quantityController.current = createCartQuantityController({
    write: async (itemId, quantity) => (await customerApi<{ cart: CustomerCart | null }>(`/api/customer/cart/items/${itemId}`, {
      method: "PATCH", body: JSON.stringify({ quantity }),
    })).cart,
    read: async () => (await customerApi<{ cart: CustomerCart | null }>("/api/customer/cart")).cart,
    onChange: value => {
      if (mounted.current) setCart(value);
      const summary = {
        units: value?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0,
        storeName: value?.storeName ?? "",
      };
      const previous = publishedSummary.current;
      if (!hasPublishedSummary.current || previous?.units !== summary.units || previous.storeName !== summary.storeName) {
        hasPublishedSummary.current = true;
        publishedSummary.current = summary;
        onCartChange?.(value);
      }
    },
    onPending: value => { if (mounted.current) setQuantityBusy(value); },
    onError: (reason, syncFailed) => { if (mounted.current) {
      setMessage(shoppingError(reason, "Unable to update your cart. Please try again."));
      if (syncFailed) setLoadFailed(true);
    } },
  });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    let refreshing = false;
    const refreshPrices = async () => {
      if (refreshing || quantityController.current!.isPending() || checkoutInFlight.current) return;
      refreshing = true;
      const version = quantityController.current!.version();
      try {
        const { cart: fresh } = await customerApi<{ cart: CustomerCart | null }>("/api/customer/cart");
        if (!active || quantityController.current!.isPending() || checkoutInFlight.current
          || quantityController.current!.version() !== version) return;
        // Replace the controller's authoritative base as well as the rendered cart:
        // another signed-in tab may have added, removed, or repriced cart lines.
        quantityController.current!.reset(fresh);
      } catch (reason) {
        if (active) setMessage(shoppingError(reason));
      }
      finally { refreshing = false; }
    };
    const timer = setInterval(() => { if (isCustomerAppForeground()) void refreshPrices(); }, 12_000);
    const unsubscribe = subscribeToCustomerForeground(() => { void refreshPrices(); });
    return () => {
      active = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, []);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const checkoutInFlight = useRef(false);
  const [deliveryMode, setDeliveryMode] = useState<CustomerDeliveryMode>("INSTANT");
  const [slotResponse, setSlotResponse] = useState<CustomerDeliverySlotsResponse | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<CustomerDeliverySlot | null>(null);
  const selectedSlotRef = useRef<CustomerDeliverySlot | null>(null);
  const [selectedDay, setSelectedDay] = useState("");
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [slotRefresh, setSlotRefresh] = useState(0);
  const [freshnessNow, setFreshnessNow] = useState(Date.now());
  const checkoutIntent = useRef<{ cartId: string; addressId: string; mode: CustomerDeliveryMode; startAt: string; endAt: string; key: string } | null>(null);
  const checkoutChoiceChanged = useRef(false);

  const [clearDialogVisible, setClearDialogVisible] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);

  const load = async () => {
    setLoading(true); setMessage(""); setLoadFailed(false);
    setDeliveryMode("INSTANT"); selectedSlotRef.current = null; setSelectedSlot(null); setSelectedDay(""); setSlotResponse(null); setSlotsError("");
    checkoutIntent.current = null;
    checkoutChoiceChanged.current = false;
    setSlotRefresh(value => value + 1);
    try {
      await waitForCartQuantityWrites();
      const [cartResult, addressResult] = await Promise.all([
        customerApi<{ cart: CustomerCart | null }>("/api/customer/cart"),
        customerApi<{ addresses: CustomerAddress[] }>("/api/customer/addresses"),
      ]);
      quantityController.current!.reset(cartResult.cart); setAddresses(addressResult.addresses);
      const selected = addressResult.addresses.find((address) => address.isDefault) ?? addressResult.addresses[0];
      if (selected) setAddressId(selected.id);
    } catch (reason) { setLoadFailed(true); setMessage(shoppingError(reason, "Unable to load your cart. Please try again.")); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const selectedAddress = addresses.find(address => address.id === addressId);
  const validSlots = useMemo(() => (slotResponse?.slots ?? []).filter(slot => isFullFutureSlot(slot, freshnessNow)), [slotResponse, freshnessNow]);
  const instantAvailable = !!cart && cart.operatingStatus === "OPEN" && cart.instantDeliveryAvailable !== false;
  const scheduledAvailable = slotResponse
    ? (slotResponse.scheduledDeliveryAvailable ?? slotResponse.slots.length > 0)
    : (cart?.scheduledDeliveryAvailable ?? false);

  useEffect(() => {
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
        const fresh = result.slots.filter(slot => isFullFutureSlot(slot, Date.now()));
        const current = selectedSlotRef.current;
        const stillAvailable = current && fresh.some(slot => slot.startAt === current.startAt && slot.endAt === current.endAt);
        if (current && !stillAvailable) {
            checkoutIntent.current = null;
            checkoutChoiceChanged.current = true;
            setMessage("That delivery time is no longer available. Choose another time.");
        }
        selectedSlotRef.current = stillAvailable ? current : null;
        setSelectedSlot(selectedSlotRef.current);
        setSelectedDay(current => fresh.some(slot => indiaDayKey(slot.startAt) === current)
          ? current
          : fresh.length ? indiaDayKey(fresh[0].startAt) : "");
        setSlotsError("");
      })
      .catch(reason => { if (active) setSlotsError(shoppingError(reason, "Available delivery times could not be loaded.")); })
      .finally(() => { if (active) setSlotsLoading(false); });
    return () => { active = false; };
  }, [deliveryMode, cart?.storeId, selectedAddress?.pincode, slotRefresh]);

  useEffect(() => {
    if (deliveryMode !== "SCHEDULED") return;
    const refreshFreshness = () => {
      setFreshnessNow(Date.now());
      setSlotRefresh(value => value + 1);
    };
    const timer = setInterval(refreshFreshness, 25_000);
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") refreshFreshness();
    });
    const onFocus = () => refreshFreshness();
    if (Platform.OS === "web" && typeof window !== "undefined") window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      subscription.remove();
      if (Platform.OS === "web" && typeof window !== "undefined") window.removeEventListener("focus", onFocus);
    };
  }, [deliveryMode]);

  useEffect(() => {
    if (!selectedSlot || isFullFutureSlot(selectedSlot, freshnessNow)) return;
    selectedSlotRef.current = null;
    setSelectedSlot(null);
    checkoutIntent.current = null;
    checkoutChoiceChanged.current = true;
    setMessage("That delivery time has passed. Choose a new available time.");
  }, [selectedSlot, freshnessNow]);

  const quantity = (itemId: string, delta: -1 | 1) => quantityController.current!.adjust(itemId, delta);

  const clear = () => { if (!quantityController.current!.isPending()) setClearDialogVisible(true); };

  const confirmClear = async () => {
    setClearLoading(true);
    try {
      await customerApi("/api/customer/cart", { method: "DELETE" });
      quantityController.current!.reset(null);
    } catch (reason) {
      setMessage(shoppingError(reason, "Unable to clear your basket. Please try again."));
    } finally {
      setClearLoading(false);
      setClearDialogVisible(false);
    }
  };

  const saveNewAddress = async () => {
    const validationError = validateAddressInput(addressDraft);
    if (validationError) {
      setAddressMessage(validationError);
      return;
    }
    setAddressSaving(true);
    setAddressMessage("");
    try {
      const { address: created } = await customerApi<{ address: CustomerAddress }>("/api/customer/addresses", {
        method: "POST",
        body: JSON.stringify(normalizeAddressInput({ ...addressDraft, isDefault: false })),
      });
      let refreshed = false;
      let nextAddresses = addresses;
      try {
        const result = await customerApi<{ addresses: CustomerAddress[] }>("/api/customer/addresses");
        nextAddresses = result.addresses;
        refreshed = true;
      } catch {
        // The created record is still usable for this checkout; keep it visible and selected.
      }
      if (!nextAddresses.some(item => item.id === created.id)) nextAddresses = [...nextAddresses, created];
      setAddresses(nextAddresses);
      setAddressId(created.id);
      selectedSlotRef.current = null;
      setSelectedSlot(null);
      setSelectedDay("");
      setSlotResponse(null);
      setSlotsError("");
      checkoutIntent.current = null;
      checkoutChoiceChanged.current = true;
      setSlotRefresh(value => value + 1);
      setAddressDraft(blankAddress);
      setAddressModalVisible(false);
      if (!refreshed) setMessage("Address saved, but the saved address list could not refresh. It is selected for this order.");
    } catch (reason) {
      setAddressMessage(shoppingError(reason, "Unable to save address. Please try again."));
    } finally {
      setAddressSaving(false);
    }
  };

  const validate = async () => {
    if (checkoutInFlight.current || checkoutBusy || !cart || !addressId) { if (!addressId) setMessage("Select or add a delivery address."); return; }
    if (deliveryMode === "INSTANT" && !instantAvailable) {
      setMessage("Instant delivery is unavailable while this store is closed. Choose an available scheduled time.");
      return;
    }
    if (deliveryMode === "SCHEDULED" && (!scheduledAvailable || !selectedSlot || !isFullFutureSlot(selectedSlot, Date.now()) || slotsLoading)) {
      setMessage("Choose an available delivery time before placing your order.");
      return;
    }
    if (quantityController.current!.isPending()) {
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
        setCart(current => current ? {
          ...current, operatingStatus: "CLOSED", instantDeliveryAvailable: false, scheduledDeliveryAvailable: undefined,
        } : current);
        setMessage(deliveryMode === "INSTANT"
          ? "Instant delivery is no longer available. Your cart is safe; choose a scheduled time if one is available."
          : "The store could not accept this delivery request. Your cart is safe; refresh delivery times and try again.");
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

  if (loading) return <View style={[commonStyles.page, styles.center]}><ActivityIndicator accessibilityLabel={t("common.loading")} color={colors.accent}/></View>;
  
  if (!cart) return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={commonStyles.page}>
      <View style={[commonStyles.container, { flex: 1, justifyContent: "center", alignItems: "center", gap: spacing.lg }]}>
        <Text style={styles.emptyHeader}>{t("My Cart")}</Text>
        {!loadFailed && <View style={styles.emptyBasket}><BasketIcon /></View>}
        <Text style={typography.title1}>{loadFailed ? t("Basket unavailable") : t("Your basket is empty")}</Text>
        {!loadFailed && <Text style={[typography.body, { textAlign: "center" }]}>{t("Add fresh groceries from a local supermarket to get started.")}</Text>}
        {!!message && <Text style={[typography.caption, { color: colors.danger }]}>{localizeCustomerMessage(message, t)}</Text>}
        <Pressable accessibilityRole="button" onPress={() => continueShopping()} style={styles.primaryBtn}><Text style={styles.primaryBtnText}>{t("Continue shopping")}</Text></Pressable>
        {loadFailed && <Pressable accessibilityRole="button" onPress={() => void load()}><Text style={typography.bodySemibold}>{t("Try again")}</Text></Pressable>}
      </View>
    </ScrollView>
  );

  return (
    <>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={commonStyles.page}>
        <View style={commonStyles.container}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("Continue shopping")} onPress={() => continueShopping(cart.storeId)} style={{ marginBottom: spacing.md }}><Text style={[typography.bodySemibold, { color: colors.accent }]}>{t("← Continue shopping")}</Text></Pressable>
          <View style={styles.cartHeader}><Text style={styles.cartHeaderText}>{t("My Cart")}</Text><Pressable accessibilityRole="button" onPress={clear}><Text style={styles.clearText}>{t("Clear")}</Text></Pressable></View>
          <Text style={[typography.caption, { marginBottom: spacing.md }]}>{t(cart.items.length === 1 ? "{count} item" : "{count} items", { count: cart.items.length })} · {cart.storeName}</Text>
          
          <View style={{ gap: spacing.md, marginBottom: spacing.xl }}>
            {cart.items.map((item) => (
              <View key={item.id} style={styles.cartItem}>
                {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.cartImage} /> : <PlaceholderImage name={item.name} style={styles.cartImage} />}
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Text style={typography.bodySemibold}>{item.name}</Text>
                  <Text style={[typography.caption, { color: colors.accent, fontWeight: "700" }]}>{formatVariantName(item.quantityValue, item.quantityUnit)}</Text>
                  <Text style={typography.caption}>₹{formatPrice(item.unitPrice)} {t("each")}</Text>
                  <Text style={typography.caption}>{t("Qty: {quantity} × {variant}", { quantity: item.quantity, variant: formatVariantName(item.quantityValue, item.quantityUnit) })}</Text>
                  <QuantitySelector quantity={item.quantity} onDecrease={() => quantity(item.id, -1)} onIncrease={() => quantity(item.id, 1)} min={0} disabled={checkoutBusy || clearLoading} />
                  {!item.purchasable && <Text style={[typography.caption, { color: colors.danger }]}>{item.unavailableReason === "OUT_OF_STOCK" ? t("Out of stock") : item.unavailableReason === "INSUFFICIENT_STOCK" ? t("No longer available in the selected quantity. Please reduce the quantity.") : t("This item is no longer available.")}</Text>}
                </View>
                <View style={{ alignItems: "flex-end", gap: spacing.sm }}>
                  <Text style={typography.title3}>₹{formatPrice(item.lineSubtotal)}</Text>
                   <Pressable accessibilityRole="button" accessibilityLabel={t("Remove")} disabled={checkoutBusy || clearLoading} onPress={() => quantityController.current!.remove(item.id)} hitSlop={10}><Text style={[typography.caption, { color: colors.danger, fontWeight: "600" }]}>{t("Remove")}</Text></Pressable>
                </View>
              </View>
            ))}
          </View>

          <View style={commonStyles.card}>
            <Line label={t("Subtotal")} value={cart.subtotal} />
            <Line label={t("Delivery fee")} value={cart.deliveryFee} />
            <Line label={localizeCustomerMessage("Handling Fee", t)} value={cart.handlingFee ?? "0.00"} />
            <Text style={[typography.caption, { marginVertical: 4 }]}>{t("Minimum order ₹{minimum}", { minimum: cart.minimumOrderValue })}</Text>
            <View style={styles.divider} />
            <Line label={t("Total")} value={cart.total} strong />
          </View>

           <Text style={[typography.title2, { marginTop: spacing.xl, marginBottom: spacing.md }]}>{t("Delivery Address")}</Text>
           {addresses.length === 0 && <Text style={[typography.caption, { marginBottom: spacing.sm }]}>{t("No addresses saved yet.")}</Text>}
           <View style={{ gap: spacing.sm }}>
               {addresses.map((address) => (
                <Pressable key={address.id} accessibilityRole="radio" accessibilityState={{ selected: addressId === address.id }} onPress={() => {
                  if (address.id !== addressId) {
                    setAddressId(address.id);
                    selectedSlotRef.current = null; setSelectedSlot(null);
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
                     {address.label && <Text style={typography.caption}>{address.recipientName}</Text>}
                    {addressStreetLines(address).map((line, index) => <Text key={`${address.id}-address-${index}`} style={typography.body}>{line}</Text>)}
                  </View>
                </Pressable>
              ))}
           </View>
           <Pressable accessibilityRole="button" onPress={() => { setAddressDraft(blankAddress); setAddressMessage(""); setAddressModalVisible(true); }} style={styles.addAddressButton}>
             <Text style={styles.addAddressPlus}>+</Text>
             <Text style={styles.addAddressText}>{t("+ Add New Address")}</Text>
           </Pressable>
           {!!addresses.length && <Pressable accessibilityRole="button" onPress={openAddresses} style={{ alignSelf: "flex-start", paddingVertical: spacing.xs }}>
             <Text style={[typography.caption, { color: colors.accent, fontWeight: fontWeights.semibold }]}>{t("Manage saved addresses")}</Text>
           </Pressable>}

          <Text style={[typography.title2, { marginTop: spacing.xl, marginBottom: spacing.md }]}>{t("Delivery Option")}</Text>
          <View style={{ gap: spacing.sm }}>
            <Pressable accessibilityRole="radio" accessibilityState={{ selected: deliveryMode === "INSTANT", disabled: !instantAvailable }} disabled={!instantAvailable} onPress={() => {
              if (deliveryMode !== "INSTANT") {
                setDeliveryMode("INSTANT"); selectedSlotRef.current = null; setSelectedSlot(null); setSelectedDay(""); checkoutIntent.current = null; checkoutChoiceChanged.current = true;
              }
            }} style={[styles.deliveryChoice, deliveryMode === "INSTANT" && styles.deliveryChoiceActive, !instantAvailable && styles.disabled]}>
              <View style={[styles.radio, deliveryMode === "INSTANT" && styles.radioActive]}>{deliveryMode === "INSTANT" && <View style={styles.radioInner} />}</View>
               <View style={{ flex: 1 }}><Text style={typography.bodySemibold}>{t("Instant Delivery")}</Text><Text style={typography.caption}>{instantAvailable ? t("Deliver as soon as possible") : t("Unavailable while the store is closed")}</Text></View>
            </Pressable>
            <Pressable accessibilityRole="radio" accessibilityState={{ selected: deliveryMode === "SCHEDULED", disabled: cart.scheduledDeliveryAvailable === false }} disabled={cart.scheduledDeliveryAvailable === false} onPress={() => {
              if (deliveryMode !== "SCHEDULED") {
                setDeliveryMode("SCHEDULED"); selectedSlotRef.current = null; setSelectedSlot(null); setSelectedDay(""); setSlotResponse(null); setSlotsError(""); checkoutIntent.current = null; checkoutChoiceChanged.current = true;
              }
            }} style={[styles.deliveryChoice, deliveryMode === "SCHEDULED" && styles.deliveryChoiceActive, cart.scheduledDeliveryAvailable === false && styles.disabled]}>
              <View style={[styles.radio, deliveryMode === "SCHEDULED" && styles.radioActive]}>{deliveryMode === "SCHEDULED" && <View style={styles.radioInner} />}</View>
               <View style={{ flex: 1 }}><Text style={typography.bodySemibold}>{t("Scheduled Delivery")}</Text><Text style={typography.caption}>{cart.scheduledDeliveryAvailable === false ? t("No future delivery times are available") : t("Choose an available time")}</Text></View>
            </Pressable>
          </View>
          {deliveryMode === "SCHEDULED" && (
            <View style={[commonStyles.card, { marginTop: spacing.md, gap: spacing.md }]}>
              <View style={styles.between}>
                 <Text style={typography.bodySemibold}>{t("Available delivery times")}</Text>
                <Pressable accessibilityRole="button" disabled={slotsLoading} onPress={() => {
                  setSlotsError("");
                  setSlotRefresh(value => value + 1);
                }} style={slotsLoading && styles.disabled}>
                  <Text style={[typography.caption, { color: colors.accent, fontWeight: fontWeights.semibold }]}>{t("Refresh")}</Text>
                </Pressable>
              </View>
              {slotsLoading ? <View style={styles.slotLoading}><ActivityIndicator color={colors.accent} /><Text style={typography.caption}>{t("Checking store availability…")}</Text></View> : null}
              {!!slotsError && !slotsLoading && <View style={{ gap: spacing.sm }}>
                <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger }]}>{localizeCustomerMessage(slotsError, t)}</Text>
                <Pressable accessibilityRole="button" onPress={() => {
                  setSlotRefresh(value => value + 1);
                 }} style={styles.secondaryBtn}><Text style={styles.secondaryBtnText}>{t("Try again")}</Text></Pressable>
              </View>}
              {!slotsError && slotResponse?.operatingStatus === "CLOSED" && <Text style={[typography.body, { color: colors.danger }]}>{t("The store is closed for instant delivery. Choose a future scheduled time to place this order.")}</Text>}
              {!slotsLoading && !slotsError && !scheduledAvailable && <Text style={typography.caption}>{t("No future delivery times are available right now. Your cart is safe; try again later.")}</Text>}
              {!slotsLoading && !slotsError && scheduledAvailable && validSlots.length === 0 && <Text style={typography.caption}>{t("No full delivery windows remain available. Refresh to check again.")}</Text>}
              {!slotsError && scheduledAvailable && validSlots.length > 0 && <>
                <View style={styles.slotDays}>
                  {availableDays(validSlots).map(day => <Pressable key={day} accessibilityRole="button" accessibilityState={{ selected: selectedDay === day }} onPress={() => {
                    if (day !== selectedDay) {
                      setSelectedDay(day);
                      setSlotRefresh(value => value + 1);
                      selectedSlotRef.current = null;
                      setSelectedSlot(null);
                      checkoutIntent.current = null;
                      checkoutChoiceChanged.current = true;
                      setSlotRefresh(value => value + 1);
                    }
                  }} style={[styles.dayChip, selectedDay === day && styles.dayChipActive]}>
                    <Text style={[styles.dayChipText, selectedDay === day && styles.dayChipTextActive]}>{dayLabel(day, language, t)}</Text>
                  </Pressable>)}
                </View>
                <View style={styles.slotTimes}>
                  {validSlots.filter(slot => indiaDayKey(slot.startAt) === selectedDay).map(slot => {
                    const chosen = selectedSlot?.startAt === slot.startAt && selectedSlot?.endAt === slot.endAt;
                    return <Pressable key={`${slot.startAt}-${slot.endAt}`} accessibilityRole="radio" accessibilityState={{ selected: chosen }} onPress={() => {
                      if (!chosen) {
                        selectedSlotRef.current = slot; setSelectedSlot(slot); checkoutIntent.current = null; checkoutChoiceChanged.current = true; setMessage("");
                      }
                    }} style={[styles.timeChip, chosen && styles.timeChipActive]}>
                      <Text style={[styles.timeChipText, chosen && styles.timeChipTextActive]}>{indiaTime(slot.startAt, language)} – {indiaTime(slot.endAt, language)}</Text>
                    </Pressable>;
                  })}
                </View>
                <Text style={typography.caption}>{t("Times shown in India Standard Time (IST).")}</Text>
              </>}
            </View>
          )}

          <Text style={[typography.title2, { marginTop: spacing.xl, marginBottom: spacing.md }]}>{t("Payment Method")}</Text>
          <View style={[commonStyles.card, { flexDirection: "row", alignItems: "center", gap: spacing.sm }]}>
            <View style={styles.radioActive}><View style={styles.radioInner} /></View>
            <Text style={typography.bodySemibold}>{t("Cash on Delivery (COD)")}</Text>
          </View>

          <View style={{ marginTop: spacing.xxl, gap: spacing.md }}>
            {cart.operatingStatus === "CLOSED" && <View accessibilityRole="alert" style={styles.closedNotice}>
              <Text style={styles.closedNoticeTitle}>{t("Store closed for instant delivery")}</Text>
              <Text style={typography.body}>{t("Your cart is safe. Select Scheduled Delivery if a valid future time is available.")}</Text>
            </View>}
            {!cart.checkoutReady && cart.operatingStatus === "CLOSED" && !scheduledAvailable
              ? <Text style={[typography.caption, { color: colors.danger, textAlign: "center" }]}>{t("This store has no currently available delivery option. Your cart is safe; try again when delivery becomes available.")}</Text>
              : !cart.checkoutReady && <Text style={[typography.caption, { color: colors.danger, textAlign: "center" }]}>{t("Resolve unavailable items or meet the minimum order value to checkout.")}</Text>}
            {!!message && <Text style={[typography.caption, { color: colors.danger, textAlign: "center" }]}>{localizeCustomerMessage(message, t)}</Text>}
            
            <Pressable accessibilityRole="button" disabled={quantityBusy || !cart.checkoutReady || !addressId || checkoutBusy || (deliveryMode === "INSTANT" && !instantAvailable) || (deliveryMode === "SCHEDULED" && (!scheduledAvailable || !selectedSlot || !isFullFutureSlot(selectedSlot, freshnessNow) || slotsLoading || !!slotsError))} onPress={validate} style={[styles.primaryBtn, (quantityBusy || !cart.checkoutReady || !addressId || checkoutBusy || (deliveryMode === "INSTANT" && !instantAvailable) || (deliveryMode === "SCHEDULED" && (!scheduledAvailable || !selectedSlot || !isFullFutureSlot(selectedSlot, freshnessNow) || slotsLoading || !!slotsError))) && styles.disabled]}>
              {checkoutBusy ? <ActivityIndicator color={colors.card} /> : <Text style={styles.primaryBtnText}>{t("Place Order • ₹{total}", { total: cart.total })}</Text>}
            </Pressable>
          </View>
        </View>
      </ScrollView>
      <ConfirmationDialog
        visible={clearDialogVisible}
        title={t("Clear Basket?")}
        message={t("The basket record will be preserved as abandoned. Are you sure?")}
        confirmLabel={t("Clear")}
        isDestructive
        loading={clearLoading}
        onConfirm={confirmClear}
        onCancel={() => !clearLoading && setClearDialogVisible(false)}
      />
      <Modal visible={addressModalVisible} transparent animationType="slide" onRequestClose={() => !addressSaving && setAddressModalVisible(false)}>
        <View style={styles.addressModalBackdrop}>
          <View style={styles.addressModal}>
            <View style={styles.addressModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={typography.eyebrow}>{t("CHECKOUT")}</Text>
                <Text style={typography.title2}>{t("Add New Address")}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={t("Cancel")} disabled={addressSaving} onPress={() => { setAddressModalVisible(false); setAddressDraft(blankAddress); setAddressMessage(""); }} hitSlop={10}>
                <Text style={styles.modalClose}>{t("Cancel")}</Text>
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: spacing.md }}>
              <CustomerAddressFields draft={addressDraft} onChange={patch => setAddressDraft(current => ({ ...current, ...patch }))} showDefaultToggle={false} />
              {!!addressMessage && <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger, marginTop: spacing.md }]}>{localizeCustomerMessage(addressMessage, t)}</Text>}
              <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg }}>
                <Pressable accessibilityRole="button" disabled={addressSaving} onPress={() => { setAddressModalVisible(false); setAddressDraft(blankAddress); setAddressMessage(""); }} style={[styles.secondaryBtn, { flex: 1 }, addressSaving && styles.disabled]}>
                  <Text style={styles.secondaryBtnText}>{t("Cancel")}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={addressSaving} onPress={saveNewAddress} style={[styles.primaryBtn, { flex: 1 }, addressSaving && styles.disabled]}>
                  {addressSaving ? <ActivityIndicator color={colors.card} /> : <Text style={styles.primaryBtnText}>{t("Save address")}</Text>}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
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

function indiaTime(value: string, language: "en" | "te") {
  return new Intl.DateTimeFormat(language === "te" ? "te-IN" : "en-IN", {
    timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(value));
}

function availableDays(slots: CustomerDeliverySlot[]) {
  return [...new Set(slots.map(slot => indiaDayKey(slot.startAt)))];
}

function isFullFutureSlot(slot: CustomerDeliverySlot, now: number) {
  const start = new Date(slot.startAt).getTime();
  const end = new Date(slot.endAt).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && start > now && end > now;
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

function dayLabel(day: string, language: "en" | "te", t: ReturnType<typeof useTranslation>["t"]) {
  const today = indiaDayKey(new Date().toISOString());
  const tomorrow = indiaDayKey(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
  if (day === today) return t("Today");
  if (day === tomorrow) return t("Tomorrow");
  const date = new Date(`${day}T12:00:00+05:30`);
  return new Intl.DateTimeFormat(language === "te" ? "te-IN" : "en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" }).format(date);
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
  addAddressButton: { minHeight: 52, borderWidth: 1, borderStyle: "dashed", borderColor: colors.accent, backgroundColor: colors.soft, borderRadius: radius.lg, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, marginTop: spacing.sm },
  addAddressPlus: { color: colors.accent, fontSize: 24, fontWeight: fontWeights.bold, lineHeight: 28 },
  addAddressText: { ...typography.bodySemibold, color: colors.accent },
  addressModalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(26, 36, 29, 0.45)" },
  addressModal: { maxHeight: "92%", backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md },
  addressModalHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: spacing.md },
  modalClose: { ...typography.caption, color: colors.accent, fontWeight: fontWeights.semibold },
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