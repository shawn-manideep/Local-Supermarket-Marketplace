import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { customerApi, type CustomerAddress, type CustomerCart } from "./lib/api";

const colors = { bg:"#F8F6EF", card:"#FFFFFF", ink:"#17352B", muted:"#61736C", accent:"#E85D3F", line:"#DDE5DF", danger:"#A53D31" };

export function CartScreen({ openAddresses, onOrderPlaced }: { openAddresses: () => void; onOrderPlaced: (orderId: string) => void }) {
  const [cart, setCart] = useState<CustomerCart | null>(null);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [addressId, setAddressId] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

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
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Unable to load cart."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const quantity = async (itemId: string, next: number) => {
    try {
      const result = await customerApi<{ cart: CustomerCart }>(`/api/customer/cart/items/${itemId}`, { method:"PATCH", body:JSON.stringify({ quantity:next }) });
      setCart(result.cart);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Unable to update cart."); }
  };
  const clear = () => Alert.alert("Clear cart?", "The cart record will be preserved as abandoned.", [
    { text:"Cancel" }, { text:"Clear", style:"destructive", onPress:() => void customerApi("/api/customer/cart", { method:"DELETE" }).then(() => setCart(null)).catch((reason) => setMessage(reason.message)) },
  ]);
  const validate = async () => {
    if (!addressId) { setMessage("Select or add a delivery address."); return; }
    setLoading(true); setMessage("");
    try {
      const result = await customerApi<{ order: { id: string } }>("/api/customer/orders", { method:"POST", body:JSON.stringify({ addressId, paymentMethod:"COD" }) });
      onOrderPlaced(result.order.id);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Unable to place order."); }
    finally { setLoading(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.accent}/></View>;
  if (!cart) return <View style={styles.center}><Text style={styles.hero}>Your cart is empty</Text><Text style={styles.body}>Add available products from one supermarket to begin.</Text>{!!message && <Text style={styles.error}>{message}</Text>}</View>;
  return <ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.eyebrow}>CART</Text><Text style={styles.hero}>{cart.storeName}</Text>
    {cart.items.map((item) => <View key={item.id} style={styles.card}>
      <View style={styles.between}><View style={{flex:1}}><Text style={styles.title}>{item.name}</Text><Text style={styles.body}>₹{item.unitPrice} each · ₹{item.lineSubtotal}</Text>{!item.purchasable && <Text style={styles.error}>Unavailable or out of stock</Text>}</View>
      <View style={styles.controls}><Pressable onPress={() => void quantity(item.id, item.quantity - 1)} style={styles.step}><Text>−</Text></Pressable><Text style={styles.title}>{item.quantity}</Text><Pressable onPress={() => void quantity(item.id, item.quantity + 1)} style={styles.step}><Text>+</Text></Pressable></View></View>
      <Pressable onPress={() => void quantity(item.id, 0)}><Text style={styles.remove}>Remove</Text></Pressable>
    </View>)}
    <View style={styles.card}><Line label="Subtotal" value={cart.subtotal}/><Line label="Delivery fee" value={cart.deliveryFee}/><Line label="Minimum order" value={cart.minimumOrderValue}/><Line label="Total" value={cart.total} strong/></View>
    <Text style={styles.title}>Delivery address</Text>
    {addresses.length === 0 ? <Pressable onPress={openAddresses} style={styles.primary}><Text style={styles.primaryText}>Add an address</Text></Pressable> : addresses.map((address) => <Pressable key={address.id} onPress={() => setAddressId(address.id)} style={[styles.address,addressId===address.id&&styles.selected]}><Text style={styles.title}>{addressId===address.id?"●":"○"} {address.label ?? address.recipientName}</Text><Text style={styles.body}>{address.line1}, {address.city} {address.pincode}</Text></Pressable>)}
    <View style={styles.card}><Text style={styles.title}>Payment method</Text><Text style={styles.body}>Cash on Delivery (COD)</Text></View>
    {!cart.checkoutReady && <Text style={styles.error}>Resolve unavailable items or meet the minimum order value before checkout.</Text>}
    {!!message && <Text style={styles.body}>{message}</Text>}
     <Pressable disabled={!cart.checkoutReady || !addressId} onPress={() => void validate()} style={[styles.primary,(!cart.checkoutReady||!addressId)&&styles.disabled]}><Text style={styles.primaryText}>Place order · COD</Text></Pressable>
    <Pressable onPress={clear}><Text style={styles.remove}>Clear cart</Text></Pressable>
  </ScrollView>;
}
function Line({label,value,strong=false}:{label:string;value:string;strong?:boolean}) { return <View style={styles.between}><Text style={strong?styles.title:styles.body}>{label}</Text><Text style={strong?styles.title:styles.body}>₹{value}</Text></View>; }
const styles=StyleSheet.create({page:{paddingTop:67,paddingBottom:40,paddingHorizontal:22,gap:14,backgroundColor:colors.bg},center:{flex:1,alignItems:"center",justifyContent:"center",padding:24,gap:12,backgroundColor:colors.bg},hero:{fontSize:30,fontWeight:"800",color:colors.ink},eyebrow:{fontSize:12,fontWeight:"800",letterSpacing:1.5,color:colors.accent},title:{fontSize:16,fontWeight:"800",color:colors.ink},body:{fontSize:14,lineHeight:21,color:colors.muted},error:{color:colors.danger},card:{backgroundColor:colors.card,borderWidth:1,borderColor:colors.line,borderRadius:16,padding:15,gap:10},between:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:12},controls:{flexDirection:"row",alignItems:"center",gap:10},step:{width:34,height:34,borderRadius:17,backgroundColor:"#E8F1EA",alignItems:"center",justifyContent:"center"},remove:{color:colors.danger,fontWeight:"700"},address:{backgroundColor:colors.card,borderWidth:1,borderColor:colors.line,borderRadius:14,padding:14,gap:4},selected:{borderColor:colors.accent,backgroundColor:"#FFF2ED"},primary:{backgroundColor:colors.ink,borderRadius:12,padding:15,alignItems:"center"},primaryText:{color:"#FFF",fontWeight:"800"},disabled:{opacity:.4}});