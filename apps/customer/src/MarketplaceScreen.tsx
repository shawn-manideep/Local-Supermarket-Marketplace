import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  customerApi,
  type CustomerAddress,
  type CustomerCategory,
  type CustomerProduct,
  type CustomerStore,
} from "./lib/api";

const colors = { bg: "#F8F6EF", card: "#FFFFFF", ink: "#17352B", muted: "#61736C", accent: "#E85D3F", line: "#DDE5DF", danger: "#A53D31" };

export function MarketplaceScreen({ openAddresses, openCart }: { openAddresses: () => void; openCart: () => void }) {
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [pincode, setPincode] = useState("");
  const [stores, setStores] = useState<CustomerStore[]>([]);
  const [store, setStore] = useState<CustomerStore | null>(null);
  const [categories, setCategories] = useState<CustomerCategory[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [products, setProducts] = useState<CustomerProduct[]>([]);
  const [product, setProduct] = useState<CustomerProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const discoveryGeneration = useRef(0);
  const catalogGeneration = useRef(0);
  const [adding, setAdding] = useState(false);

  const clearCatalog = () => {
    ++catalogGeneration.current;
    setCategories([]);
    setProducts([]);
    setProduct(null);
    setCategoryId("");
  };

  const selectPincode = (nextPincode: string) => {
    ++discoveryGeneration.current;
    clearCatalog();
    setStore(null);
    setStores([]);
    setPincode(nextPincode);
  };

  const selectStore = (nextStore: CustomerStore | null) => {
    clearCatalog();
    setError("");
    if (!nextStore) setLoading(false);
    setStore(nextStore);
  };

  useEffect(() => {
    customerApi<{ addresses: CustomerAddress[] }>("/api/customer/addresses")
      .then(({ addresses: next }) => {
        setAddresses(next);
        const selected = next.find((address) => address.isDefault) ?? next[0];
        if (selected) setPincode(selected.pincode);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load addresses."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!pincode) { setStores([]); return; }
    const generation = ++discoveryGeneration.current;
    ++catalogGeneration.current;
    setLoading(true); setError(""); setStore(null); setStores([]); setCategories([]); setProducts([]); setProduct(null);
    customerApi<{ stores: CustomerStore[] }>(`/api/customer/stores?pincode=${pincode}`)
      .then(({ stores: next }) => { if (generation === discoveryGeneration.current) setStores(next); })
      .catch((reason) => { if (generation === discoveryGeneration.current) setError(reason instanceof Error ? reason.message : "Unable to find stores."); })
      .finally(() => { if (generation === discoveryGeneration.current) setLoading(false); });
  }, [pincode]);

  useEffect(() => {
    if (!store) return;
    const generation = ++catalogGeneration.current;
    setLoading(true); setError(""); setCategoryId(""); setProduct(null); setCategories([]); setProducts([]);
    Promise.all([
      customerApi<{ categories: CustomerCategory[] }>(`/api/customer/stores/${store.id}/categories?pincode=${pincode}`),
      customerApi<{ products: CustomerProduct[] }>(`/api/customer/stores/${store.id}/products?pincode=${pincode}`),
    ]).then(([categoryResult, productResult]) => {
      if (generation === catalogGeneration.current) {
        setCategories(categoryResult.categories);
        setProducts(productResult.products);
      }
    }).catch((reason) => {
      if (generation === catalogGeneration.current) {
        setError(reason instanceof Error ? reason.message : "Unable to load this catalog.");
      }
    })
      .finally(() => { if (generation === catalogGeneration.current) setLoading(false); });
  }, [store, pincode]);

  const filterProducts = async (nextCategoryId: string) => {
    if (!store) return;
    const generation = ++catalogGeneration.current;
    setCategoryId(nextCategoryId); setLoading(true); setProducts([]); setError("");
    const suffix = nextCategoryId ? `&categoryId=${nextCategoryId}` : "";
    try {
      const result = await customerApi<{ products: CustomerProduct[] }>(`/api/customer/stores/${store.id}/products?pincode=${pincode}${suffix}`);
      if (generation === catalogGeneration.current) setProducts(result.products);
    } catch (reason) { if (generation === catalogGeneration.current) setError(reason instanceof Error ? reason.message : "Unable to filter products."); }
    finally { if (generation === catalogGeneration.current) setLoading(false); }
  };

  const showProduct = async (selected: CustomerProduct) => {
    if (!store) return;
    const generation = ++catalogGeneration.current;
    setLoading(true); setProduct(null); setError("");
    try {
      const result = await customerApi<{ product: CustomerProduct }>(`/api/customer/stores/${store.id}/products/${selected.id}?pincode=${pincode}`);
      if (generation === catalogGeneration.current) setProduct(result.product);
    } catch (reason) { if (generation === catalogGeneration.current) setError(reason instanceof Error ? reason.message : "Unable to load product."); }
    finally { if (generation === catalogGeneration.current) setLoading(false); }
  };

  const addToCart = async (selected: CustomerProduct, confirmStoreSwitch = false) => {
    if (adding) return;
    setAdding(true);
    try {
      await customerApi("/api/customer/cart/items", { method:"POST", body:JSON.stringify({ productId:selected.id, quantity:1, confirmStoreSwitch }) });
      openCart();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to add product.";
      if (message === "Store switch required") {
        Alert.alert("Start a new cart?", "Your cart contains items from another supermarket. Start a new cart for this supermarket?", [
          { text:"Cancel" }, { text:"Start new cart", style:"destructive", onPress:() => void addToCart(selected, true) },
        ]);
      } else setError(message);
    } finally { setAdding(false); }
  };

  if (product && store) return <ScrollView contentContainerStyle={styles.page}>
    <Pressable onPress={() => { ++catalogGeneration.current; setProduct(null); }}><Text style={styles.link}>← Back to {store.name}</Text></Pressable>
    {product.imageUrl && <Image source={{ uri: product.imageUrl }} style={styles.heroImage} />}
    <Text style={styles.hero}>{product.name}</Text><Text style={styles.price}>₹{product.price}</Text>
    <Text style={styles.body}>{product.description ?? "No description provided."}</Text>
    <Text style={[styles.badge, !product.availability && styles.closed]}>{product.availability ? "Available" : "Unavailable"}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Add product to cart" disabled={!product.availability || adding} onPress={() => void addToCart(product)} style={[styles.primary,!product.availability&&{opacity:.4}]}><Text style={styles.primaryText}>{adding ? "Adding…" : product.availability?"Add to Cart":"Unavailable"}</Text></Pressable>
  </ScrollView>;

  if (store) return <ScrollView contentContainerStyle={styles.page}>
    <Pressable onPress={() => selectStore(null)}><Text style={styles.link}>← Change supermarket</Text></Pressable>
    <Text style={styles.eyebrow}>{store.operatingStatus}</Text><Text style={styles.hero}>{store.name}</Text>
    <Text style={styles.body}>{store.description ?? "Browse this supermarket’s catalog."}</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <Pressable onPress={() => void filterProducts("")} style={[styles.chip, !categoryId && styles.chipActive]}><Text>All</Text></Pressable>
      {categories.map((category) => <Pressable key={category.id} onPress={() => void filterProducts(category.id)} style={[styles.chip, categoryId === category.id && styles.chipActive]}><Text>{category.name}</Text></Pressable>)}
    </ScrollView>
    {loading ? <ActivityIndicator color={colors.accent} /> : products.length === 0 ? <Text style={styles.body}>No products in this category.</Text> : products.map((item) =>
      <Pressable key={item.id} onPress={() => void showProduct(item)} style={styles.row}>
        {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.thumb} /> : <View style={styles.thumb} />}
        <View style={styles.copy}><Text style={styles.title}>{item.name}</Text><Text style={styles.price}>₹{item.price}</Text><Text style={[styles.body, !item.availability && styles.danger]}>{item.availability ? "Available" : "Unavailable"}</Text></View>
      </Pressable>)}
    {!!error && <Text style={styles.danger}>{error}</Text>}
  </ScrollView>;

  return <ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.eyebrow}>NEAR YOU</Text><Text style={styles.hero}>Local supermarkets</Text>
    {addresses.length > 0 && <ScrollView horizontal>{addresses.map((address) => <Pressable key={address.id} onPress={() => selectPincode(address.pincode)} style={[styles.chip, pincode === address.pincode && styles.chipActive]}><Text>{address.label ?? address.city} · {address.pincode}</Text></Pressable>)}</ScrollView>}
    {loading ? <ActivityIndicator color={colors.accent} /> : addresses.length === 0 ? <View style={styles.card}><Text style={styles.title}>Add an address to find supermarkets near you.</Text><Pressable onPress={openAddresses} style={styles.primary}><Text style={styles.primaryText}>Add an address</Text></Pressable></View> : stores.length === 0 ? <Text style={styles.body}>No active supermarkets currently serve {pincode}.</Text> : stores.map((item) =>
      <Pressable key={item.id} onPress={() => selectStore(item)} style={styles.row}>
        {item.logoImageUrl ? <Image source={{ uri: item.logoImageUrl }} style={styles.logo} /> : <View style={styles.logo} />}
        <View style={styles.copy}><Text style={styles.title}>{item.name}</Text><Text style={styles.body}>Delivery ₹{item.deliveryFee} · Minimum ₹{item.minimumOrderValue}</Text><Text style={[styles.badge, item.operatingStatus === "CLOSED" && styles.closed]}>{item.operatingStatus}</Text></View>
      </Pressable>)}
    {!!error && <Text style={styles.danger}>{error}</Text>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page:{paddingTop:67,paddingBottom:38,paddingHorizontal:22,gap:16,backgroundColor:colors.bg},hero:{fontSize:34,lineHeight:40,fontWeight:"800",color:colors.ink},eyebrow:{fontSize:12,fontWeight:"800",letterSpacing:1.5,color:colors.accent},body:{fontSize:15,lineHeight:22,color:colors.muted},title:{fontSize:17,fontWeight:"800",color:colors.ink},price:{fontSize:18,fontWeight:"800",color:colors.ink},link:{color:colors.accent,fontWeight:"700",paddingVertical:8},card:{backgroundColor:colors.card,borderRadius:18,padding:18,gap:15,borderWidth:1,borderColor:colors.line},row:{flexDirection:"row",backgroundColor:colors.card,borderRadius:16,padding:14,gap:14,borderWidth:1,borderColor:colors.line},copy:{flex:1,gap:5},logo:{width:64,height:64,borderRadius:15,backgroundColor:"#E8F1EA"},thumb:{width:72,height:72,borderRadius:12,backgroundColor:"#E8F1EA"},heroImage:{width:"100%",height:260,borderRadius:18,backgroundColor:"#E8F1EA"},chip:{paddingVertical:9,paddingHorizontal:14,borderRadius:20,backgroundColor:colors.card,borderWidth:1,borderColor:colors.line,marginRight:8},chipActive:{backgroundColor:"#F4CDBF",borderColor:colors.accent},badge:{alignSelf:"flex-start",fontSize:12,fontWeight:"800",color:colors.ink,backgroundColor:"#DCEBDF",paddingHorizontal:9,paddingVertical:5,borderRadius:10},closed:{backgroundColor:"#F2D4CE",color:colors.danger},danger:{color:colors.danger},primary:{backgroundColor:colors.ink,borderRadius:12,padding:15,alignItems:"center"},primaryText:{color:"#FFFFFF",fontWeight:"800"},
});