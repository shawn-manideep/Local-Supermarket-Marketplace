import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { customerApi, type CustomerOrderDetail, type CustomerOrderSummary } from "./lib/api";
import { colors, radius, spacing, typography, commonStyles, shadows } from "./theme";
import { ConfirmationDialog } from "./components/ConfirmationDialog";

const money = (value: string) => `₹${Number(value).toFixed(2)}`;
const date = (value: string) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const deliveryLabel = (value: string) => value === "vendor_staff" ? "Vendor Delivery" : "Platform Delivery";

export function OrdersScreen({ initialOrderId }: { initialOrderId?: string } = {}) {
  const [orders, setOrders] = useState<CustomerOrderSummary[]>([]);
  const [selected, setSelected] = useState<CustomerOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"All" | "Processing" | "Delivered" | "Cancelled">("All");
  const listGeneration = useRef(0);
  const detailGeneration = useRef(0);

  const load = async () => {
    const request = ++listGeneration.current;
    setLoading(true); setError("");
    try { const result = await customerApi<{ orders: CustomerOrderSummary[] }>("/api/customer/orders"); if (request === listGeneration.current) setOrders(result.orders); }
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

  if (selected) return <OrderDetail order={selected} back={() => { ++detailGeneration.current; setSelected(null); }} refresh={load} />;
  
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
              <Pressable accessibilityRole="button" key={order.id} onPress={() => void open(order.id)} style={styles.orderCard}>
                <View style={styles.between}>
                  <Text style={typography.title3}>#{order.id.slice(0, 8).toUpperCase()}</Text>
                  <Text style={typography.body}>{date(order.createdAt)}</Text>
                </View>
                <View style={styles.between}>
                  <Text style={typography.caption}>{order.storeName}</Text>
                  <Text style={typography.bodySemibold}>Total: {money(order.totalAmount)}</Text>
                </View>
                <View style={[styles.statusBadge, order.status === "CANCELLED" ? styles.statusBadgeCancelled : null]}>
                  <Text style={[styles.statusBadgeText, order.status === "CANCELLED" ? styles.statusBadgeTextCancelled : null]}>{order.status.replaceAll("_", " ")}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function OrderDetail({ order, back, refresh }: { order: CustomerOrderDetail; back: () => void; refresh: () => void; }) {
  const [cancelVisible, setCancelVisible] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [localOrder, setLocalOrder] = useState(order);
  const [error, setError] = useState("");

  const handleCancel = async () => {
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
          
          <View style={styles.confirmBox}>
            <View>
              <Text style={{ fontSize: 11, fontWeight: "800", color: "#A7C0B1", letterSpacing: 1.2 }}>REFERENCE</Text>
              <Text style={{ fontSize: 28, fontWeight: "800", color: colors.card }}>#{localOrder.id.slice(0, 8).toUpperCase()}</Text>
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
                    <Text style={typography.caption}>{money(item.productPriceSnapshot)} × {item.quantity}</Text>
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
            <Text style={typography.body}>{localOrder.deliveryAddressSnapshot.line1}{localOrder.deliveryAddressSnapshot.line2 ? `, ${localOrder.deliveryAddressSnapshot.line2}` : ""}</Text>
            <Text style={typography.body}>{localOrder.deliveryAddressSnapshot.city}, {localOrder.deliveryAddressSnapshot.state} {localOrder.deliveryAddressSnapshot.pincode}</Text>
            <Text style={[typography.caption, { marginTop: spacing.sm }]}>{deliveryLabel(localOrder.deliveryType)}</Text>
          </View>

          {!!error && <Text style={[typography.caption, { color: colors.danger, marginBottom: spacing.md, textAlign: "center" }]}>{error}</Text>}

          {localOrder.status === "PLACED" && (
            <Pressable onPress={() => setCancelVisible(true)} style={styles.cancelBtn}>
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
  listHeader: { backgroundColor: colors.accent, color: colors.card, fontSize: 20, fontWeight: "800", marginHorizontal: -spacing.lg, marginTop: -16, padding: spacing.lg },
  filters: { flexDirection: "row", justifyContent: "space-between", gap: 4, marginVertical: spacing.lg },
  filter: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20 },
  filterActive: { backgroundColor: colors.accent },
  filterText: { color: colors.muted, fontSize: 11, fontWeight: "600" },
  filterTextActive: { color: colors.card },
  emptyState: { alignItems: "center", padding: spacing.xl, backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.line, gap: spacing.md, marginTop: spacing.lg },
  errorBox: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.highlight, gap: spacing.xs, marginBottom: spacing.lg },
  orderCard: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: spacing.lg, gap: spacing.sm, ...shadows.sm },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: 2 },
  statusBadge: { alignSelf: "flex-start", backgroundColor: colors.soft, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, marginTop: spacing.xs },
  statusBadgeCancelled: { backgroundColor: colors.highlight },
  statusBadgeText: { fontSize: 11, fontWeight: "800", color: colors.ink, textTransform: "uppercase" },
  statusBadgeTextCancelled: { color: colors.danger },
  confirmBox: { backgroundColor: colors.ink, borderRadius: radius.xl, padding: spacing.xl, flexDirection: "row", justifyContent: "space-between", alignItems: "center", ...shadows.md },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.line, marginTop: 4 },
  dotActive: { backgroundColor: colors.accent },
  timelineLine: { width: 2, flex: 1, backgroundColor: colors.line, marginVertical: 4 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: spacing.md },
  cancelBtn: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, alignItems: "center", backgroundColor: colors.card },
  cancelBtnText: { ...typography.bodySemibold, color: colors.danger },
});
