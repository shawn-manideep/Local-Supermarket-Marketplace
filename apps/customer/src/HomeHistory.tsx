import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { formatPrice } from "@workspace/validation/variant-formatting";
import { customerApi, type CustomerOrderSummary, type RepeatOrderPreview } from "./lib/api";
import { reorderPreviewQuery } from "./lib/reorder";
import { colors, radius, spacing, typography } from "./theme";
import { RepeatOrderDialog } from "./OrdersScreen";
import { homeHistorySelection, homeRecentStore, homePreviewRows, homeItemAvailable, type HomePreviewRow } from "./lib/home-history";

export function HomeHistory({ active, addressId, stores, storesReady = true, onOpenStore, onOpenOrder, onCart }: {
  active: boolean;
  addressId: string;
  stores: Array<{ id: string; name: string }>;
  storesReady?: boolean;
  onOpenStore: (storeId: string) => void;
  onOpenOrder: (orderId: string) => void;
  onCart: () => void;
}) {
  const [orders, setOrders] = useState<CustomerOrderSummary[]>([]);
  const [activeOrder, setActiveOrder] = useState<CustomerOrderSummary | null>(null);
  const [rows, setRows] = useState<HomePreviewRow[]>([]);
  const [hasHistory, setHasHistory] = useState(false);
  const [loadedAddressId, setLoadedAddressId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [buyAgain, setBuyAgain] = useState<{ orderId: string; itemId: string } | null>(null);
  const storeById = new Map(stores.map(store => [store.id, store]));
  const currentScope = active && loadedAddressId === addressId;

  useEffect(() => {
    setBuyAgain(null);
    if (!active || !addressId) {
      setOrders([]);
      setActiveOrder(null);
      setRows([]);
      setLoadedAddressId("");
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let live = true;
    setLoading(true);
    setError("");
    setOrders([]);
    setActiveOrder(null);
    setRows([]);
    setHasHistory(false);
    setLoadedAddressId("");
    customerApi<{ orders: CustomerOrderSummary[] }>("/api/customer/orders", { signal: controller.signal })
      .then(async ({ orders: allOrders }) => {
        if (!live) return;
        const { recent, activeOrder: currentOrder, hasHistory: historyExists } = homeHistorySelection(allOrders);
        setOrders(recent);
        setActiveOrder(currentOrder);
        setHasHistory(historyExists);
        const results = await Promise.all(recent.map(async order => {
          const preview = await customerApi<RepeatOrderPreview>(
            `/api/customer/orders/${order.id}/repeat-preview?${reorderPreviewQuery(addressId)}`,
            { signal: controller.signal },
          );
          return { orderId: order.id, preview };
        }));
        if (!live) return;
        setRows(homePreviewRows(results));
        setLoadedAddressId(addressId);
      })
      .catch(() => {
        if (live && !controller.signal.aborted) {
          setLoadedAddressId(addressId);
          setError("We couldn't load your recent shopping. Try again.");
        }
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; controller.abort(); };
  }, [active, addressId, retry]);

  const latest = orders[0];
  const recentStore = homeRecentStore(orders, stores);

  return <>
    {currentScope && activeOrder && <View style={styles.orderPanel}>
      <View style={{ flex: 1 }}>
        <Text style={typography.eyebrow}>YOUR CURRENT ORDER</Text>
        <Text style={[typography.bodySemibold, { marginTop: spacing.xs }]}>{activeOrder.storeName} · {activeOrder.status.replaceAll("_", " ")}</Text>
         <Text style={typography.caption}>Order #{activeOrder.id.slice(0, 8).toUpperCase()}</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={() => onOpenOrder(activeOrder.id)} style={styles.smallButton}><Text style={styles.buttonText}>View order</Text></Pressable>
    </View>}

    {currentScope && storesReady && latest && <View style={styles.section}>
      <Text style={typography.title3}>Recent Store</Text>
      {recentStore ? <Pressable accessibilityRole="button" onPress={() => onOpenStore(recentStore.id)} style={styles.storePanel}>
        <View style={{ flex: 1 }}>
          <Text style={typography.bodySemibold}>{recentStore.name}</Text>
          <Text style={typography.caption}>From your latest order · Shop this supermarket</Text>
        </View>
        <Text style={styles.arrow}>›</Text>
      </Pressable> : <View style={styles.storePanel}>
        <Text style={[typography.caption, { flex: 1 }]}>Your last supermarket is not available at this delivery location.</Text>
      </View>}
    </View>}

    <View style={styles.section}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, marginBottom: spacing.md }}>
        <Text style={[typography.title3, { flexShrink: 1 }]}>Recently Ordered</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh recent shopping and order status" disabled={loading || !addressId || !currentScope} onPress={() => setRetry(value => value + 1)}>
          <Text style={[typography.caption, { color: colors.accent }]}>Refresh</Text>
        </Pressable>
      </View>
      {loading || (!!addressId && !currentScope) ? <View style={styles.loading}><ActivityIndicator color={colors.accent} /><Text style={[typography.caption, { flex: 1, minWidth: 0 }]}>Checking current availability and prices…</Text></View>
        : error ? <View style={styles.message}><Text accessibilityRole="alert" style={typography.body}>{error}</Text><Pressable accessibilityRole="button" onPress={() => setRetry(value => value + 1)} style={styles.smallButton}><Text style={styles.buttonText}>Try again</Text></Pressable></View>
        : !addressId ? <View style={styles.message}><Text style={typography.caption}>Choose a delivery address to check current prices and availability.</Text></View>
        : orders.length === 0 ? <View style={styles.message}><Text style={typography.bodySemibold}>{hasHistory ? "No recent shopping to repeat" : "No orders yet"}</Text><Text style={typography.caption}>{hasHistory ? "Your cancelled or rejected orders remain in Orders." : "Your ordered groceries will appear here."}</Text></View>
        : rows.length === 0 ? <View style={styles.message}><Text style={typography.caption}>No recent item details are available to check right now.</Text></View>
        : <View style={styles.items}>
          {rows.map(({ orderId, item, storeAvailable, storeName }) => {
             const available = homeItemAvailable({ orderId, item, storeAvailable, storeName });
            return <View key={`${orderId}:${item.orderItemId}`} style={styles.item}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={typography.bodySemibold} numberOfLines={2}>{item.productName}{item.variantNameSnapshot ? ` · ${item.variantNameSnapshot}` : ""}</Text>
                <Text style={typography.caption} numberOfLines={1}>{storeName} · Qty {item.quantity}</Text>
                <Text style={[typography.caption, !available && styles.unavailable]}>
                  {available ? `Available · ₹${formatPrice(item.currentUnitPrice!)} each` : !storeAvailable ? "Store unavailable for this address" : item.reason || (item.available ? "Current price unavailable" : "Currently unavailable")}
                </Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: !available }} disabled={!available}
                onPress={() => setBuyAgain({ orderId, itemId: item.orderItemId })}
                style={[styles.buyButton, !available && styles.disabled]}>
                <Text style={styles.buttonText}>Buy Again</Text>
              </Pressable>
            </View>;
          })}
        </View>}
    </View>
    <RepeatOrderDialog orderId={currentScope ? buyAgain?.orderId ?? null : null} orderItemId={buyAgain?.itemId} initialAddressId={addressId}
      onClose={() => setBuyAgain(null)} onAdded={() => { setBuyAgain(null); onCart(); }}
      onContinueShopping={() => {
        const selectedOrder = orders.find(order => order.id === buyAgain?.orderId);
        setBuyAgain(null);
        if (selectedOrder && storeById.has(selectedOrder.storeId)) onOpenStore(selectedOrder.storeId);
      }} />
  </>;
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.xl },
  orderPanel: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.soft, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.lg },
  storePanel: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.md },
  arrow: { color: colors.accent, fontSize: 24, fontWeight: "700" },
  items: { gap: spacing.sm },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: spacing.md },
  buyButton: { backgroundColor: colors.accent, borderRadius: radius.md, minHeight: 44, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, alignItems: "center", justifyContent: "center" },
  smallButton: { backgroundColor: colors.accent, borderRadius: radius.md, minHeight: 40, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, justifyContent: "center" },
  buttonText: { color: colors.card, fontSize: 12, fontWeight: "700" },
  disabled: { opacity: 0.45 },
  unavailable: { color: colors.danger },
  loading: { flexDirection: "row", gap: spacing.md, alignItems: "center", padding: spacing.lg, backgroundColor: colors.card, borderRadius: radius.lg },
  message: { gap: spacing.sm, padding: spacing.lg, backgroundColor: colors.card, borderRadius: radius.lg, alignItems: "flex-start" },
});