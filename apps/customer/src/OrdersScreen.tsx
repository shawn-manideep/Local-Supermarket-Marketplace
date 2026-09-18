import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { customerApi, type CustomerOrderDetail, type CustomerOrderStatus, type CustomerOrderSummary } from "./lib/api";

const colors = { bg: "#F8F6EF", card: "#FFFFFF", ink: "#17352B", muted: "#61736C", accent: "#E85D3F", line: "#DDE5DF", danger: "#A53D31", soft: "#E8F1EA" };
const stages: CustomerOrderStatus[] = ["PLACED", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED"];
const money = (value: string) => `₹${Number(value).toFixed(2)}`;
const date = (value: string) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function OrdersScreen({ initialOrderId }: { initialOrderId?: string } = {}) {
  const [orders, setOrders] = useState<CustomerOrderSummary[]>([]);
  const [selected, setSelected] = useState<CustomerOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try { const result = await customerApi<{ orders: CustomerOrderSummary[] }>("/api/customer/orders"); setOrders(result.orders); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load orders."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const open = async (id: string) => {
    setLoading(true); setError("");
    try { const result = await customerApi<{ order: CustomerOrderDetail }>(`/api/customer/orders/${id}`); setSelected(result.order); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load order."); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (initialOrderId) void open(initialOrderId); }, [initialOrderId]);
  const cancel = () => {
    if (!selected) return;
    Alert.alert("Cancel this order?", "Cancellation is available while the order is still placed.", [
      { text: "Keep order" },
      { text: "Cancel order", style: "destructive", onPress: async () => {
        try {
          const result = await customerApi<{ order?: CustomerOrderDetail } | CustomerOrderDetail>(`/api/customer/orders/${selected.id}/cancel`, { method: "POST" });
          const next: CustomerOrderDetail = "order" in result ? result.order as CustomerOrderDetail : result as CustomerOrderDetail;
          setSelected(next);
          await load();
        }
        catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to cancel order."); }
      } },
    ]);
  };
  if (selected) return <OrderDetail order={selected} back={() => setSelected(null)} cancel={cancel} error={error} />;
  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.accent} /><Text style={styles.body}>Loading your orders…</Text></View>;
  return <ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.eyebrow}>ORDERS</Text><Text style={styles.hero}>Your orders</Text><Text style={styles.body}>A clear record from local shop to doorstep.</Text>
    {!!error && <View style={styles.errorBox}><Text style={styles.error}>{error}</Text><Pressable onPress={() => void load()}><Text style={styles.link}>Try again</Text></Pressable></View>}
    {orders.length === 0 && !error ? <View style={styles.empty}><Text style={styles.title}>No orders yet</Text><Text style={styles.body}>Your first supermarket order will appear here.</Text></View> : orders.map((order) =>
      <Pressable key={order.id} onPress={() => void open(order.id)} style={styles.card}>
        <View style={styles.between}><View><Text style={styles.title}>{order.storeName}</Text><Text style={styles.body}>{date(order.createdAt)}</Text></View><Text style={styles.status}>{order.status.replaceAll("_", " ")}</Text></View>
        <View style={styles.between}><Text style={styles.body}>Order #{order.id.slice(0, 8)}</Text><Text style={styles.total}>{money(order.totalAmount)}</Text></View>
      </Pressable>)}
  </ScrollView>;
}

function OrderDetail({ order, back, cancel, error }: { order: CustomerOrderDetail; back: () => void; cancel: () => void; error: string }) {
  const current = order.status === "CANCELLED" ? -1 : stages.indexOf(order.status);
  return <ScrollView contentContainerStyle={styles.page}>
    <Pressable onPress={back}><Text style={styles.link}>← All orders</Text></Pressable>
    <Text style={styles.eyebrow}>ORDER CONFIRMED</Text><Text style={styles.hero}>{order.storeName}</Text>
    <View style={styles.confirm}><Text style={styles.confirmLabel}>REFERENCE</Text><Text style={styles.reference}>#{order.id.slice(0, 8).toUpperCase()}</Text><Text style={styles.status}>{order.status.replaceAll("_", " ")}</Text></View>
    <View style={styles.card}><Text style={styles.title}>Status timeline</Text>{order.statusHistory.map((entry, index) => <View key={entry.id} style={styles.timeline}><View style={[styles.dot, index === order.statusHistory.length - 1 && styles.dotActive]} /><View style={{ flex: 1 }}><Text style={styles.title}>{entry.status.replaceAll("_", " ")}</Text><Text style={styles.body}>{entry.note ?? "Order update"} · {date(entry.createdAt)}</Text></View></View>)}{current >= 0 && current < stages.length && <Text style={styles.body}>We’ll keep you posted as your order moves through the shop.</Text>}</View>
    <View style={styles.card}>{order.items.map((item) => <View key={item.id} style={styles.itemLine}><View style={{ flex: 1 }}><Text style={styles.title}>{item.productNameSnapshot}</Text><Text style={styles.body}>{money(item.productPriceSnapshot)} each · Qty {item.quantity}</Text></View><Text style={styles.body}>{money(item.subtotal)}</Text></View>)}<View style={styles.rule} /><Line label="Subtotal" value={order.subtotal} /><Line label="Delivery fee" value={order.deliveryFeeSnapshot} /><Line label="Total" value={order.totalAmount} strong /></View>
    <View style={styles.card}><Text style={styles.title}>Delivery details</Text><Text style={styles.body}>{order.deliveryContactName} · {order.deliveryContactPhone}</Text><Text style={styles.body}>{order.deliveryAddressSnapshot.line1}{order.deliveryAddressSnapshot.line2 ? `, ${order.deliveryAddressSnapshot.line2}` : ""}, {order.deliveryAddressSnapshot.city}, {order.deliveryAddressSnapshot.state} {order.deliveryAddressSnapshot.pincode}</Text><Text style={styles.body}>Cash on Delivery · {order.deliveryType}</Text></View>
    {!!error && <Text style={styles.error}>{error}</Text>}
    {order.status === "PLACED" && <Pressable onPress={cancel} style={styles.cancel}><Text style={styles.cancelText}>Cancel order</Text></Pressable>}
  </ScrollView>;
}
function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) { return <View style={styles.between}><Text style={strong ? styles.title : styles.body}>{label}</Text><Text style={strong ? styles.title : styles.body}>{money(value)}</Text></View>; }
const styles = StyleSheet.create({
  page:{paddingTop:67,paddingBottom:40,paddingHorizontal:22,gap:15,backgroundColor:colors.bg},center:{flex:1,alignItems:"center",justifyContent:"center",padding:24,gap:10,backgroundColor:colors.bg},hero:{fontSize:32,lineHeight:38,fontWeight:"800",color:colors.ink},eyebrow:{fontSize:12,fontWeight:"800",letterSpacing:1.5,color:colors.accent},body:{fontSize:14,lineHeight:21,color:colors.muted},title:{fontSize:16,fontWeight:"800",color:colors.ink},total:{fontSize:17,fontWeight:"800",color:colors.ink},card:{backgroundColor:colors.card,borderWidth:1,borderColor:colors.line,borderRadius:16,padding:16,gap:12},between:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:12},itemLine:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:12},status:{fontSize:11,fontWeight:"800",color:colors.ink,backgroundColor:colors.soft,paddingHorizontal:9,paddingVertical:6,borderRadius:9},link:{color:colors.accent,fontWeight:"800",paddingVertical:5},empty:{padding:24,alignItems:"center",gap:8,backgroundColor:colors.card,borderRadius:16,borderWidth:1,borderColor:colors.line},errorBox:{padding:14,borderRadius:14,backgroundColor:"#F7E4DE",gap:5},error:{color:colors.danger},confirm:{backgroundColor:colors.ink,borderRadius:18,padding:20,gap:7},confirmLabel:{fontSize:11,fontWeight:"800",letterSpacing:1.4,color:"#B9D0C2"},reference:{fontSize:25,fontWeight:"800",color:"#FFF"},timeline:{flexDirection:"row",gap:12,alignItems:"flex-start"},dot:{width:12,height:12,borderRadius:6,marginTop:4,backgroundColor:colors.line},dotActive:{backgroundColor:colors.accent},rule:{height:1,backgroundColor:colors.line},cancel:{borderWidth:1,borderColor:colors.danger,borderRadius:12,padding:14,alignItems:"center"},cancelText:{color:colors.danger,fontWeight:"800"}
});