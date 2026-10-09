import { useEffect, useRef, useState } from "react";
import { randomUUID } from "expo-crypto";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { CustomerText as Text } from "./components/CustomerTypography";
import { customerApi, type CustomerAddress, type CustomerOrderDetail, type CustomerOrderSummary, type RepeatOrderPreview, type RepeatOrderResult } from "./lib/api";
import { colors, fontWeights, radius, spacing, typography, commonStyles, shadows } from "./theme";
import { ConfirmationDialog } from "./components/ConfirmationDialog";
import { reorderInput, reorderItemLabel, reorderPreviewQuery, reorderSummary } from "./lib/reorder";
import { addressStreetLines } from "./lib/address-format";

const money = (value: string) => `₹${Number(value).toFixed(2)}`;
const date = (value: string) => new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const deliveryLabel = (value: string) => value === "vendor_staff" ? "Vendor Delivery" : "Platform Delivery";
const deliverySchedule = (order: Pick<CustomerOrderSummary, "deliveryMode" | "scheduledStartAt" | "scheduledEndAt">) => {
  if (order.deliveryMode !== "SCHEDULED") return "Instant delivery";
  if (!order.scheduledStartAt || !order.scheduledEndAt) return "Scheduled delivery";
  const day = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric",
  }).format(new Date(order.scheduledStartAt));
  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true,
  });
  return `Scheduled · ${day} · ${time.format(new Date(order.scheduledStartAt))} – ${time.format(new Date(order.scheduledEndAt))} IST`;
};

function createSecureUuid(): string {
  return randomUUID();
}

export function OrdersScreen({ initialOrderId, onRepeatAdded, onContinueShopping }: { initialOrderId?: string; onRepeatAdded?: () => void; onContinueShopping?: () => void } = {}) {
  const [orders, setOrders] = useState<CustomerOrderSummary[]>([]);
  const [selected, setSelected] = useState<CustomerOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"All" | "Processing" | "Delivered" | "Cancelled">("All");
  const [repeatOrderId, setRepeatOrderId] = useState<string | null>(null);
  const [repeatItemId, setRepeatItemId] = useState<string | undefined>();
  const startReorder = (id: string, itemId?: string) => {
    setRepeatItemId(itemId);
    setRepeatOrderId(id);
  };
  const listGeneration = useRef(0);
  const detailGeneration = useRef(0);

  const load = async () => {
    const request = ++listGeneration.current;
    setLoading(true); setError("");
    try {
      const result = await customerApi<{ orders: CustomerOrderSummary[] }>("/api/customer/orders");
      if (request === listGeneration.current) setOrders(result.orders);
    }
    catch (reason) { if (request === listGeneration.current) setError(reason instanceof Error ? reason.message : "Unable to load orders."); }
    finally { if (request === listGeneration.current) setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const open = async (id: string) => {
    const request = ++detailGeneration.current;
    setLoading(true); setError("");
    try { const result = await customerApi<{ order: CustomerOrderDetail }>(`/api/customer/orders/${id}`); if (request === detailGeneration.current) setSelected(result.order); }
    catch (reason) { if (request === detailGeneration.current) setError(reason instanceof Error ? reason.message : "Unable to load order."); }
    finally { if (request === detailGeneration.current) setLoading(false); }
  };
  useEffect(() => { if (initialOrderId) void open(initialOrderId); }, [initialOrderId]);

  if (selected) return <>
    <OrderDetail order={selected} back={() => { ++detailGeneration.current; setSelected(null); }} refresh={load} onRepeat={(itemId) => startReorder(selected.id, itemId)} />
    <RepeatOrderDialog orderId={repeatOrderId} orderItemId={repeatItemId} onClose={() => setRepeatOrderId(null)} onAdded={() => { setRepeatOrderId(null); onRepeatAdded?.(); }} onContinueShopping={() => { setRepeatOrderId(null); onContinueShopping?.(); }} />
  </>;
  
  if (loading) return <View style={[commonStyles.page, { justifyContent: "center", alignItems: "center" }]}><ActivityIndicator color={colors.accent} /></View>;
  
  return (
    <ScrollView contentContainerStyle={commonStyles.page}>
      <View style={commonStyles.container}>
        <Text style={styles.listHeader}>My Orders</Text>
        <View style={styles.filters}>{(["All", "Processing", "Delivered", "Cancelled"] as const).map(item => <Pressable accessibilityRole="button" accessibilityState={{ selected: filter === item }} key={item} onPress={() => setFilter(item)} style={[styles.filter, filter === item && styles.filterActive]}><Text style={[styles.filterText, filter === item && styles.filterTextActive]}>{item}</Text></Pressable>)}</View>
        
        {!!error && (
          <View style={styles.errorBox}>
            <Text style={[typography.bodySemibold, { color: colors.danger }]}>{error}</Text>
            <Pressable onPress={() => void load()}><Text style={[typography.bodySemibold, { color: colors.ink, textDecorationLine: "underline" }]}>Try again</Text></Pressable>
          </View>
        )}
        
        {orders.length === 0 && !error ? (
          <View style={styles.emptyState}>
            <Text style={typography.title2}>No orders yet</Text>
            <Text style={typography.body}>Your first supermarket order will appear here.</Text>
          </View>
        ) : orders.length > 0 && !orders.some(order => filter === "All" || (filter === "Processing" ? !["DELIVERED", "CANCELLED", "REJECTED"].includes(order.status) : filter === "Delivered" ? order.status === "DELIVERED" : ["CANCELLED", "REJECTED"].includes(order.status))) ? (
          <View style={styles.emptyState}><Text style={typography.title2}>No {filter.toLowerCase()} orders</Text></View>
        ) : (
          <View style={{ gap: spacing.md }}>
              {orders.filter(order => filter === "All" || (filter === "Processing" ? !["DELIVERED", "CANCELLED", "REJECTED"].includes(order.status) : filter === "Delivered" ? order.status === "DELIVERED" : ["CANCELLED", "REJECTED"].includes(order.status))).map((order) => (
               <View key={order.id} style={styles.orderCard}>
                <View style={styles.between}>
                  <Text style={typography.title3}>#{order.id.slice(0, 8).toUpperCase()}</Text>
                  <Text style={typography.body}>{date(order.createdAt)}</Text>
                </View>
                 <Text style={typography.caption}>{deliverySchedule(order)}</Text>
                <View style={styles.between}>
                   <Text style={[typography.bodySemibold, { flex: 1, paddingRight: spacing.sm }]}>{order.storeName}</Text>
                  <Text style={typography.bodySemibold}>Total: {money(order.totalAmount)}</Text>
                </View>
                <View style={[styles.statusBadge, order.status === "CANCELLED" ? styles.statusBadgeCancelled : null]}>
                  <Text style={[styles.statusBadgeText, order.status === "CANCELLED" ? styles.statusBadgeTextCancelled : null]}>{order.status.replaceAll("_", " ")}</Text>
                </View>
                 {!!order.itemSummary?.length && <Text numberOfLines={2} style={typography.caption}>{order.itemSummary.map(item => `${item.productNameSnapshot}${item.variantNameSnapshot ? ` · ${item.variantNameSnapshot}` : ""} × ${item.quantity}`).join("  ·  ")}</Text>}
                 <View style={styles.orderActions}>
                   <Pressable accessibilityRole="button" onPress={() => void open(order.id)} style={styles.viewOrderButton}><Text style={styles.viewOrderText}>View Order</Text></Pressable>
                    {!!order.itemSummary?.length && <Pressable accessibilityRole="button" onPress={() => startReorder(order.id)} style={styles.repeatButton}><Text style={styles.repeatText}>Reorder</Text></Pressable>}
                 </View>
               </View>
            ))}
          </View>
        )}
      </View>
      <RepeatOrderDialog orderId={repeatOrderId} orderItemId={repeatItemId} onClose={() => setRepeatOrderId(null)} onAdded={() => { setRepeatOrderId(null); onRepeatAdded?.(); }} onContinueShopping={() => { setRepeatOrderId(null); onContinueShopping?.(); }} />
    </ScrollView>
  );
}

export function RepeatOrderDialog({ orderId, orderItemId, initialAddressId, onClose, onAdded, onContinueShopping }: { orderId: string | null; orderItemId?: string; initialAddressId?: string; onClose: () => void; onAdded: () => void; onContinueShopping: () => void }) {
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [addressId, setAddressId] = useState("");
  const [preview, setPreview] = useState<RepeatOrderPreview | null>(null);
  const [result, setResult] = useState<RepeatOrderResult | null>(null);
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const idempotencyIntent = useRef<{ orderId: string; addressId: string; orderItemId?: string; confirmStoreSwitch: boolean; key: string } | null>(null);
  const submissionInFlight = useRef(false);

  useEffect(() => {
    const intent = idempotencyIntent.current;
    if (intent && (intent.orderId !== orderId || intent.addressId !== addressId || intent.orderItemId !== orderItemId)) {
      idempotencyIntent.current = null;
    }
  }, [orderId, addressId, orderItemId]);

  useEffect(() => {
    if (!orderId) return;
    let active = true;
    setAddresses([]);
    setAddressId("");
    setPreview(null);
    setResult(null);
    setConfirmSwitch(false);
    setMessage("");
    setLoadingAddresses(true);
    customerApi<{ addresses: CustomerAddress[] }>("/api/customer/addresses")
      .then(({ addresses: next }) => {
        if (!active) return;
        setAddresses(next);
        setAddressId((next.find(address => address.id === initialAddressId) ?? next.find(address => address.isDefault) ?? next[0])?.id ?? "");
      })
      .catch(() => { if (active) setMessage("We couldn't load your delivery addresses. Please try again."); })
      .finally(() => { if (active) setLoadingAddresses(false); });
    return () => { active = false; };
  }, [orderId, orderItemId, initialAddressId]);

  useEffect(() => {
    if (!orderId || !addressId) return;
    let active = true;
    setLoadingPreview(true);
    setPreview(null);
    setConfirmSwitch(false);
    setMessage("");
    customerApi<RepeatOrderPreview>(`/api/customer/orders/${orderId}/repeat-preview?${reorderPreviewQuery(addressId, orderItemId)}`)
      .then(result => { if (active) setPreview(result); })
      .catch(() => { if (active) setMessage("We couldn't check these items right now. Please try again."); })
      .finally(() => { if (active) setLoadingPreview(false); });
    return () => { active = false; };
  }, [orderId, addressId, orderItemId, retry]);

  const addAvailableItems = async (confirmedStoreSwitch = false) => {
    if (!orderId || !addressId || !preview || submitting || submissionInFlight.current) return;
    if (preview.storeSwitchRequired && !confirmedStoreSwitch) {
      setConfirmSwitch(true);
      return;
    }
    submissionInFlight.current = true;
    setSubmitting(true);
    setMessage("");
    try {
      let intent = idempotencyIntent.current;
      if (!intent || intent.orderId !== orderId || intent.addressId !== addressId ||
        intent.orderItemId !== orderItemId || intent.confirmStoreSwitch !== confirmedStoreSwitch) {
        intent = { orderId, addressId, orderItemId, confirmStoreSwitch: confirmedStoreSwitch, key: createSecureUuid() };
        idempotencyIntent.current = intent;
      }
      const result = await customerApi<RepeatOrderResult>(`/api/customer/orders/${orderId}/repeat`, {
        method: "POST",
        body: JSON.stringify(reorderInput(addressId, intent.key, orderItemId, confirmedStoreSwitch)),
      });
      if (idempotencyIntent.current?.key === intent.key) idempotencyIntent.current = null;
      setConfirmSwitch(false);
      setResult(result);
    } catch (reason) {
      setConfirmSwitch(false);
      if (reason instanceof Error && reason.message === "Store switch required") {
        setRetry(value => value + 1);
        setMessage("Your cart's store has changed. Please check availability again before replacing it.");
      } else setMessage("We couldn't add these items right now. Please try again.");
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false);
    }
  };

  return <><Modal transparent animationType="fade" visible={!!orderId && !confirmSwitch} onRequestClose={() => !submissionInFlight.current && onClose()}>
    <View style={styles.modalShade}>
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.repeatModal} contentContainerStyle={styles.repeatModalContent}>
        <Text style={typography.eyebrow}>REVIEW BEFORE ADDING</Text>
        <Text style={[typography.title1, { marginTop: spacing.xs }]}>{orderItemId ? "Buy Again" : "Reorder"}</Text>
        {result ? <>
          <Text accessibilityRole="alert" style={[typography.title3, { marginVertical: spacing.md }]}>{reorderSummary(result)}</Text>
          {result.addedCount > 0 && <Text style={typography.body}>Items added to your cart. Review current prices and quantities before checkout.</Text>}
          {result.unavailable.length > 0 && <Text style={[typography.body, { marginTop: spacing.sm }]}>{result.unavailable.some(item => item.reason === "Original product variant is no longer available") ? "Some items are no longer available." : "Some items are currently unavailable."}</Text>}
          <ScrollView style={styles.previewList} contentContainerStyle={{ gap: spacing.sm }}>
            {result.added.map(item => <View key={item.orderItemId} style={styles.previewItem}><View style={{ flex: 1 }}>
              <Text style={typography.bodySemibold}>{reorderItemLabel(item)} — Added</Text>
              <Text style={typography.caption}>Quantity {item.quantity} · Current price {item.currentUnitPrice !== null ? money(item.currentUnitPrice) : "available in cart"} each</Text>
            </View></View>)}
            {result.unavailable.map(item => <View key={item.orderItemId} style={styles.previewItem}><View style={{ flex: 1 }}>
              <Text style={typography.bodySemibold}>{reorderItemLabel(item)} — Unavailable</Text>
              <Text style={[typography.caption, { color: colors.danger }]}>{item.reason || "Currently unavailable"}</Text>
            </View></View>)}
          </ScrollView>
          {result.addedCount === 0 && <Text style={typography.caption}>Your existing cart has not been changed.</Text>}
          <View style={styles.modalActions}>
            <Pressable accessibilityRole="button" onPress={onContinueShopping} style={styles.modalCancel}><Text style={styles.modalCancelText}>Continue Shopping</Text></Pressable>
            {result.addedCount > 0 && <Pressable accessibilityRole="button" onPress={onAdded} style={styles.modalAdd}><Text style={styles.modalAddText}>View Cart</Text></Pressable>}
          </View>
          <Pressable accessibilityRole="button" onPress={onClose} style={{ paddingTop: spacing.md, alignSelf: "center" }}><Text style={styles.repeatText}>Back to Orders</Text></Pressable>
        </> : <>
        <Text style={[typography.caption, { marginTop: spacing.xs, marginBottom: spacing.md }]}>We’ll check current availability and prices. This will not place an order.</Text>
        {loadingAddresses ? <ActivityIndicator color={colors.accent} /> : addresses.length > 0 ? <>
          <Text style={[typography.bodySemibold, { marginBottom: spacing.xs }]}>Delivery address</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
            {addresses.map(address => <Pressable key={address.id} disabled={submitting} onPress={() => {
              if (address.id !== addressId) {
                idempotencyIntent.current = null;
                setAddressId(address.id);
              }
            }} style={[styles.addressChip, addressId === address.id && styles.addressChipActive]}>
              <Text style={[styles.addressChipText, addressId === address.id && styles.addressChipTextActive]}>{address.label || address.city}{address.isDefault ? " · Default" : ""}</Text>
              <Text style={[typography.caption, { maxWidth: 220 }]} numberOfLines={2}>{addressStreetLines(address).join(", ")}</Text>
            </Pressable>)}
          </ScrollView>
        </> : !message && <Text style={styles.noticeText}>Add a delivery address before reordering.</Text>}
        {loadingPreview && <View style={styles.previewLoading}><ActivityIndicator color={colors.accent} /><Text style={typography.caption}>Checking store, variants and current prices…</Text></View>}
        {preview && <>
          {!preview.storeAvailable && <View style={styles.warningBox}><Text style={styles.warningText}>This supermarket is currently unavailable for the selected address. No items can be added.</Text></View>}
          {preview.storeSwitchRequired && preview.storeAvailable && <Text style={typography.caption}>Your cart contains items from {preview.existingStoreName}. This reorder is from {preview.storeName}. You will be asked before replacing your cart.</Text>}
          <ScrollView style={styles.previewList} contentContainerStyle={{ gap: spacing.sm }}>
            {preview.items.map(item => <View key={item.orderItemId} style={styles.previewItem}>
              <View style={[styles.availabilityMark, item.available && preview.storeAvailable ? styles.markAvailable : styles.markUnavailable]}><Text style={styles.availabilityMarkText}>{item.available && preview.storeAvailable ? "✓" : "!"}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={typography.bodySemibold}>{reorderItemLabel(item)}</Text>
                <Text style={typography.caption}>Quantity {item.quantity}{item.currentUnitPrice != null ? ` · Current price ${money(item.currentUnitPrice)} each` : ""}</Text>
                {(!item.available || !preview.storeAvailable) && <Text style={[typography.caption, { color: colors.danger }]}>{item.reason || (preview.storeAvailable ? "Currently unavailable" : "Store unavailable")}</Text>}
              </View>
            </View>)}
          </ScrollView>
          <Text style={[typography.bodySemibold, { marginTop: spacing.sm }]}>{preview.canAddCount > 0 ? `${preview.canAddCount} ${preview.canAddCount === 1 ? "item" : "items"} can be added to your cart.${preview.canAddCount < preview.items.length ? " Partially available." : ""}` : "None of these items are currently available."}</Text>
        </>}
        {!!message && <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger, marginTop: spacing.sm }]}>{message}</Text>}
        {!!message && !loadingPreview && addressId && !preview && <Pressable onPress={() => setRetry(value => value + 1)} style={{ alignSelf: "flex-start", marginTop: spacing.xs }}><Text style={styles.repeatText}>Try availability check again</Text></Pressable>}
        <View style={styles.modalActions}>
          <Pressable accessibilityRole="button" onPress={onClose} disabled={submitting} style={styles.modalCancel}><Text style={styles.modalCancelText}>Cancel</Text></Pressable>
          {preview && preview.canAddCount === 0 ? <Pressable accessibilityRole="button" onPress={onContinueShopping} style={styles.modalAdd}><Text style={styles.modalAddText}>Continue Shopping</Text></Pressable> :
            <Pressable accessibilityRole="button" onPress={() => void addAvailableItems()} disabled={!preview || !preview.storeAvailable || loadingPreview || submitting} style={[styles.modalAdd, (!preview || !preview.storeAvailable || loadingPreview || submitting) && styles.buttonDisabled]}>
              {submitting ? <><ActivityIndicator color={colors.card} /><Text style={styles.modalAddText}>Checking availability...</Text></> : <Text style={styles.modalAddText}>Add Available Items</Text>}
            </Pressable>}
        </View>
        </>}
      </ScrollView>
    </View>
  </Modal>
    <ConfirmationDialog visible={!!orderId && confirmSwitch} title="Replace your current cart?"
      message={`Your cart contains items from ${preview?.existingStoreName ?? "another store"}. This reorder is from ${preview?.storeName ?? "the original store"}. Replace your current cart?`}
      confirmLabel="Clear Cart & Continue" cancelLabel="Cancel" isDestructive loading={submitting}
      onConfirm={() => void addAvailableItems(true)} onCancel={() => !submissionInFlight.current && setConfirmSwitch(false)} />
  </>;
}

function OrderDetail({ order, back, refresh, onRepeat }: { order: CustomerOrderDetail; back: () => void; refresh: () => void; onRepeat: (itemId?: string) => void }) {
  const [cancelVisible, setCancelVisible] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const cancelInFlight = useRef(false);
  const [localOrder, setLocalOrder] = useState(order);
  const [error, setError] = useState("");
  const refreshGeneration = useRef(0);

  // Keep the accepted receipt/status screen current without a second tracking model.
  useEffect(() => {
    setLocalOrder(order);
    const controller = new AbortController();
    const refreshStatus = async () => {
      if (cancelInFlight.current) return;
      const generation = ++refreshGeneration.current;
      try {
        const result = await customerApi<{ order: CustomerOrderDetail }>(`/api/customer/orders/${order.id}`, { signal: controller.signal });
        if (!controller.signal.aborted && generation === refreshGeneration.current) {
          setLocalOrder(result.order);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted && generation === refreshGeneration.current) {
          setError("Could not refresh order status. Your last verified status is shown.");
        }
      }
    };
    const timer = setInterval(() => { void refreshStatus(); }, 45_000);
    return () => { controller.abort(); clearInterval(timer); ++refreshGeneration.current; };
  }, [order]);

  const handleCancel = async () => {
    if (cancelInFlight.current) return;
    ++refreshGeneration.current;
    cancelInFlight.current = true;
    setCancelLoading(true); setError("");
    try {
      const result = await customerApi<{ order?: CustomerOrderDetail } | CustomerOrderDetail>(`/api/customer/orders/${localOrder.id}/cancel`, { method: "POST" });
      const next = "order" in result ? result.order as CustomerOrderDetail : result as CustomerOrderDetail;
      setLocalOrder(next);
      setCancelVisible(false);
      refresh(); // update the list in background
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to cancel order.");
      setCancelVisible(false);
    } finally {
      cancelInFlight.current = false;
      setCancelLoading(false);
    }
  };

  return (
    <>
      <ScrollView contentContainerStyle={commonStyles.page}>
        <View style={commonStyles.container}>
          <Pressable onPress={back} style={{ paddingVertical: spacing.sm, alignSelf: "flex-start", marginBottom: spacing.sm }}>
            <Text style={[typography.bodySemibold, { color: colors.accent }]}>← All Orders</Text>
          </Pressable>
          
          <Text style={typography.eyebrow}>ORDER SUMMARY</Text>
          <Text style={[typography.hero, { marginBottom: spacing.lg }]}>{localOrder.storeName}</Text>
          <Text style={[typography.caption, { marginTop: -spacing.md, marginBottom: spacing.md }]}>{date(localOrder.createdAt)}</Text>
          
          <View style={styles.confirmBox}>
            <View>
              <Text style={{ fontSize: 11, fontWeight: fontWeights.medium, color: "rgba(255,255,255,0.8)", letterSpacing: 1.2 }}>REFERENCE</Text>
              <Text style={{ fontSize: 28, fontWeight: fontWeights.bold, color: colors.card }}>#{localOrder.id.slice(0, 8).toUpperCase()}</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
              <Text style={[styles.statusBadgeText, { color: colors.card }]}>{localOrder.status.replaceAll("_", " ")}</Text>
            </View>
          </View>
          
          <View style={[commonStyles.card, { marginTop: spacing.xl }]}>
            <Text style={[typography.title3, { marginBottom: spacing.md }]}>Status Timeline</Text>
            <View style={{ gap: spacing.lg }}>
              {localOrder.statusHistory.map((entry, index) => {
                const isLast = index === localOrder.statusHistory.length - 1;
                return (
                  <View key={entry.id} style={{ flexDirection: "row", gap: spacing.md }}>
                    <View style={{ width: 14, alignItems: "center" }}>
                      <View style={[styles.dot, isLast && styles.dotActive]} />
                      {!isLast && <View style={styles.timelineLine} />}
                    </View>
                    <View style={{ flex: 1, paddingBottom: isLast ? 0 : spacing.sm }}>
                      <Text style={typography.bodySemibold}>{entry.status.replaceAll("_", " ")}</Text>
                      <Text style={typography.caption}>{entry.note ?? "Status updated"} • {date(entry.createdAt)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={[commonStyles.card, { marginTop: spacing.xl }]}>
            <Text style={[typography.title3, { marginBottom: spacing.md }]}>Items</Text>
            <View style={{ gap: spacing.md }}>
              {localOrder.items.map((item) => (
                <View key={item.id} style={styles.between}>
                  <View style={{ flex: 1, paddingRight: spacing.sm }}>
                    <Text style={typography.bodySemibold}>{item.productNameSnapshot}</Text>
                    <Text style={typography.caption}>{item.variantNameSnapshot ?? (item.variantQuantityValueSnapshot && item.variantQuantityUnitSnapshot ? `${item.variantQuantityValueSnapshot} ${item.variantQuantityUnitSnapshot}` : "Standard")} · {money(item.productPriceSnapshot)} × {item.quantity}</Text>
                     <Pressable accessibilityRole="button" accessibilityLabel={`Buy ${item.productNameSnapshot} again`} onPress={() => onRepeat(item.id)} style={{ paddingVertical: spacing.sm, alignSelf: "flex-start" }}><Text style={styles.repeatText}>Buy Again</Text></Pressable>
                  </View>
                  <Text style={typography.bodySemibold}>{money(item.subtotal)}</Text>
                </View>
              ))}
            </View>
            <View style={styles.divider} />
            <Line label="Subtotal" value={localOrder.subtotal} />
            <Line label="Delivery fee" value={localOrder.deliveryFeeSnapshot} />
            <View style={styles.divider} />
            <Line label="Total Paid (COD)" value={localOrder.totalAmount} strong />
          </View>

          <View style={[commonStyles.card, { marginTop: spacing.xl, marginBottom: spacing.xl }]}>
            <Text style={[typography.title3, { marginBottom: spacing.md }]}>Delivery details</Text>
            <Text style={typography.body}>{localOrder.deliveryContactName} • {localOrder.deliveryContactPhone}</Text>
            {addressStreetLines(localOrder.deliveryAddressSnapshot).map((line, index) => <Text key={`order-address-${localOrder.id}-${index}`} style={typography.body}>{line}</Text>)}
            <Text style={[typography.caption, { marginTop: spacing.sm }]}>{deliveryLabel(localOrder.deliveryType)}</Text>
            <Text style={[typography.bodySemibold, { marginTop: spacing.sm }]}>{deliverySchedule(localOrder)}</Text>
            {localOrder.deliveryMode === "SCHEDULED" && <Text style={typography.caption}>Delivery window shown in India Standard Time (IST).</Text>}
          </View>

          {!!error && <Text style={[typography.caption, { color: colors.danger, marginBottom: spacing.md, textAlign: "center" }]}>{error}</Text>}

          {localOrder.items.length > 0 && <Pressable accessibilityRole="button" onPress={() => onRepeat()} style={[styles.repeatButton, { marginBottom: spacing.md }]}><Text style={styles.repeatText}>Reorder</Text></Pressable>}
          {localOrder.status === "PLACED" && (
            <Pressable accessibilityRole="button" onPress={() => setCancelVisible(true)} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel Order</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
      
      <ConfirmationDialog
        visible={cancelVisible}
        title="Cancel Order?"
        message="Are you sure you want to cancel this order? This action cannot be undone."
        confirmLabel="Yes, Cancel"
        cancelLabel="Keep Order"
        isDestructive
        loading={cancelLoading}
        onConfirm={handleCancel}
        onCancel={() => !cancelLoading && setCancelVisible(false)}
      />
    </>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) { 
  return (
    <View style={styles.between}>
      <Text style={strong ? typography.title3 : typography.body}>{label}</Text>
      <Text style={strong ? typography.title3 : typography.bodySemibold}>{money(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  listHeader: { backgroundColor: colors.accent, color: colors.card, fontSize: 20, fontWeight: fontWeights.bold, marginHorizontal: -spacing.lg, marginTop: -16, padding: spacing.lg },
  filters: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-start", gap: 4, marginVertical: spacing.lg },
  filter: { minHeight: 44, justifyContent: "center", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20 },
  filterActive: { backgroundColor: colors.accent },
  filterText: { color: colors.muted, fontSize: 11, fontWeight: "600" },
  filterTextActive: { color: colors.card },
  emptyState: { alignItems: "center", padding: spacing.xl, backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.line, gap: spacing.md, marginTop: spacing.lg },
  errorBox: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.highlight, gap: spacing.xs, marginBottom: spacing.lg },
  orderCard: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: spacing.lg, gap: spacing.sm, ...shadows.sm },
  orderActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  viewOrderButton: { flex: 1, minHeight: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  viewOrderText: { color: colors.ink, fontWeight: fontWeights.semibold, fontSize: 13 },
  repeatButton: { flex: 1, minHeight: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.soft, borderWidth: 1, borderColor: colors.accent },
  repeatText: { color: colors.accent, fontWeight: fontWeights.semibold, fontSize: 13 },
  modalShade: { flex: 1, backgroundColor: colors.overlay, justifyContent: "center", padding: spacing.lg },
  repeatModal: { width: "100%", maxWidth: 430, maxHeight: "88%", alignSelf: "center", backgroundColor: colors.bg, borderRadius: radius.xl, padding: spacing.lg, ...shadows.md },
  repeatModalContent: { flexGrow: 1, gap: spacing.xs },
  addressChip: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: colors.line, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.card },
  addressChipActive: { backgroundColor: colors.soft, borderColor: colors.accent },
  addressChipText: { fontSize: 12, fontWeight: "600", color: colors.ink },
  addressChipTextActive: { color: colors.accent },
  previewLoading: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl },
  previewList: { maxHeight: 250, marginTop: spacing.sm },
  previewItem: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: spacing.md },
  availabilityMark: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  markAvailable: { backgroundColor: colors.soft },
  markUnavailable: { backgroundColor: colors.highlight },
  availabilityMarkText: { color: colors.accent, fontSize: 13, fontWeight: fontWeights.semibold },
  warningBox: { borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.highlight, marginBottom: spacing.sm },
  warningText: { color: colors.danger, fontSize: 13, fontWeight: fontWeights.semibold, lineHeight: 19 },
  switchConfirm: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.soft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: colors.muted, alignItems: "center", justifyContent: "center" },
  checkboxActive: { borderColor: colors.accent, backgroundColor: colors.accent },
  checkboxDot: { width: 8, height: 8, borderRadius: 2, backgroundColor: colors.card },
  noticeText: { color: colors.danger, fontSize: 13, marginVertical: spacing.sm },
  modalActions: { flexDirection: "column-reverse", gap: spacing.sm, marginTop: spacing.lg },
  modalCancel: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  modalCancelText: { color: colors.ink, fontWeight: fontWeights.semibold },
  modalAdd: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.accent },
  modalAddText: { color: colors.card, fontWeight: fontWeights.semibold, fontSize: 13 },
  buttonDisabled: { opacity: 0.45 },
  between: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: spacing.xs, marginVertical: 2 },
  statusBadge: { alignSelf: "flex-start", backgroundColor: colors.soft, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, marginTop: spacing.xs },
  statusBadgeCancelled: { backgroundColor: colors.highlight },
  statusBadgeText: { fontSize: 11, fontWeight: fontWeights.medium, color: colors.ink, textTransform: "uppercase" },
  statusBadgeTextCancelled: { color: colors.danger },
  confirmBox: { backgroundColor: colors.ink, borderRadius: radius.xl, padding: spacing.xl, flexDirection: "row", justifyContent: "space-between", alignItems: "center", ...shadows.md },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.line, marginTop: 4 },
  dotActive: { backgroundColor: colors.accent },
  timelineLine: { width: 2, flex: 1, backgroundColor: colors.line, marginVertical: 4 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: spacing.md },
  cancelBtn: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, alignItems: "center", backgroundColor: colors.card },
  cancelBtnText: { ...typography.bodySemibold, color: colors.danger },
});
