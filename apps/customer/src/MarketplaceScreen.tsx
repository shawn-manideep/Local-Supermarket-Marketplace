import { useEffect, useRef, useState, useCallback } from "react";
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View, Animated } from "react-native";
import {
  customerApi,
  type CustomerAddress,
  type CustomerCategory,
  type CustomerProduct,
  type CustomerStore,
} from "./lib/api";

const colors = {
  bg: "#F7F5F0",
  card: "#FFFFFF",
  ink: "#1C2924",
  muted: "#5F7068",
  accent: "#D45543",
  line: "#E3DFD5",
  danger: "#C13521",
  soft: "#EAF0EC",
  highlight: "#FFF2EF",
};

function Skeleton({ style }: { style?: any }) {
  const anim = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 800, useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(anim, { toValue: 0.5, duration: 800, useNativeDriver: Platform.OS !== "web" })
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [anim]);
  return <Animated.View style={[styles.skeleton, style, { opacity: anim }]} />;
}

function SearchIcon() {
  return (
    <View style={styles.searchIconWrapper}>
      <View style={styles.searchIconCircle} />
      <View style={styles.searchIconHandle} />
    </View>
  );
}

const StoreSkeleton = () => (
  <View style={styles.storeCard}>
    <View style={styles.storeCardInner}>
      <Skeleton style={styles.skeletonLogo} />
      <View style={styles.storeInfo}>
        <View style={styles.storeTitleRow}>
          <Skeleton style={styles.skeletonTextLong} />
        </View>
        <Skeleton style={styles.skeletonTextShort} />
        <Skeleton style={styles.skeletonTextShort} />
      </View>
    </View>
  </View>
);

export function MarketplaceScreen({ openAddresses, openCart }: { openAddresses: () => void; openCart: () => void }) {
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [pincode, setPincode] = useState("");
  const [stores, setStores] = useState<CustomerStore[]>([]);
  const [store, setStore] = useState<CustomerStore | null>(null);
  const [categories, setCategories] = useState<CustomerCategory[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [products, setProducts] = useState<CustomerProduct[]>([]);
  const [product, setProduct] = useState<CustomerProduct | null>(null);
  
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [loadingStores, setLoadingStores] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
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

  const selectStore = (nextStore: CustomerStore | null) => {
    clearCatalog();
    setError("");
    if (!nextStore) setLoadingCatalog(false);
    setStore(nextStore);
  };

  const loadAddresses = useCallback(() => {
    setLoadingAddresses(true); setError("");
    customerApi<{ addresses: CustomerAddress[] }>("/api/customer/addresses")
      .then(({ addresses: next }) => {
        setAddresses(next);
        const selected = next.find((address) => address.isDefault) ?? next[0];
        if (selected) setPincode(selected.pincode);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load locations."))
      .finally(() => setLoadingAddresses(false));
  }, []);

  useEffect(() => { loadAddresses(); }, [loadAddresses]);

  const loadStores = useCallback(() => {
    if (!pincode) { setStores([]); return; }
    const generation = ++discoveryGeneration.current;
    setLoadingStores(true); setError(""); setStore(null); setStores([]); setCategories([]); setProducts([]); setProduct(null);
    customerApi<{ stores: CustomerStore[] }>(`/api/customer/stores?pincode=${pincode}`)
      .then(({ stores: next }) => { if (generation === discoveryGeneration.current) setStores(next); })
      .catch((reason) => { if (generation === discoveryGeneration.current) setError(reason instanceof Error ? reason.message : "Unable to find supermarkets."); })
      .finally(() => { if (generation === discoveryGeneration.current) setLoadingStores(false); });
  }, [pincode]);

  useEffect(() => { loadStores(); }, [loadStores]);

  useEffect(() => {
    if (!store) return;
    const generation = ++catalogGeneration.current;
    setLoadingCatalog(true); setError(""); setCategoryId(""); setProduct(null); setCategories([]); setProducts([]);
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
    }).finally(() => { if (generation === catalogGeneration.current) setLoadingCatalog(false); });
  }, [store, pincode]);

  const filterProducts = async (nextCategoryId: string) => {
    if (!store) return;
    const generation = ++catalogGeneration.current;
    setCategoryId(nextCategoryId); setLoadingCatalog(true); setProducts([]); setError("");
    const suffix = nextCategoryId ? `&categoryId=${nextCategoryId}` : "";
    try {
      const result = await customerApi<{ products: CustomerProduct[] }>(`/api/customer/stores/${store.id}/products?pincode=${pincode}${suffix}`);
      if (generation === catalogGeneration.current) setProducts(result.products);
    } catch (reason) { if (generation === catalogGeneration.current) setError(reason instanceof Error ? reason.message : "Unable to filter products."); }
    finally { if (generation === catalogGeneration.current) setLoadingCatalog(false); }
  };

  const showProduct = async (selected: CustomerProduct) => {
    if (!store) return;
    const generation = ++catalogGeneration.current;
    setLoadingCatalog(true); setProduct(null); setError("");
    try {
      const result = await customerApi<{ product: CustomerProduct }>(`/api/customer/stores/${store.id}/products/${selected.id}?pincode=${pincode}`);
      if (generation === catalogGeneration.current) setProduct(result.product);
    } catch (reason) { if (generation === catalogGeneration.current) setError(reason instanceof Error ? reason.message : "Unable to load product."); }
    finally { if (generation === catalogGeneration.current) setLoadingCatalog(false); }
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

  if (product && store) return (
    <ScrollView contentContainerStyle={styles.page}>
      <Pressable accessibilityLabel={`Back to ${store.name}`} accessibilityRole="button" onPress={() => { ++catalogGeneration.current; setProduct(null); }}><Text style={styles.link}>← Back to {store.name}</Text></Pressable>
      {product.imageUrl && <Image source={{ uri: product.imageUrl }} style={styles.heroImage} />}
      <Text style={styles.hero}>{product.name}</Text><Text style={styles.price}>₹{product.price}</Text>
      <Text style={styles.body}>{product.description ?? "No description provided."}</Text>
      <Text style={[styles.badge, !product.availability && styles.closed]}>{product.availability ? "Available" : "Unavailable"}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Add ${product.name} to cart`} accessibilityState={{ disabled: !product.availability || adding, busy: adding }} disabled={!product.availability || adding} onPress={() => void addToCart(product)} style={[styles.primary,(!product.availability || adding)&&styles.disabled]}><Text style={styles.primaryText}>{adding ? "Adding…" : product.availability?"Add to Cart":"Unavailable"}</Text></Pressable>
    </ScrollView>
  );

  if (store) return (
    <ScrollView contentContainerStyle={styles.page}>
      <Pressable accessibilityLabel="Change supermarket" accessibilityRole="button" onPress={() => selectStore(null)}><Text style={styles.link}>← Change supermarket</Text></Pressable>
      <Text style={styles.eyebrow}>{store.operatingStatus}</Text><Text style={styles.hero}>{store.name}</Text>
      <Text style={styles.body}>{store.description ?? "Browse this supermarket’s catalog."}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
        <Pressable accessibilityLabel="Show all products" accessibilityRole="button" accessibilityState={{ selected: !categoryId, busy: loadingCatalog && !categoryId }} onPress={() => void filterProducts("")} style={[styles.chip, !categoryId && styles.chipActive]}><Text style={!categoryId ? styles.chipActiveText : styles.chipText}>All</Text></Pressable>
        {categories.map((category) => <Pressable accessibilityLabel={`Filter by ${category.name}`} accessibilityRole="button" accessibilityState={{ selected: categoryId === category.id, busy: loadingCatalog && categoryId === category.id }} key={category.id} onPress={() => void filterProducts(category.id)} style={[styles.chip, categoryId === category.id && styles.chipActive]}><Text style={categoryId === category.id ? styles.chipActiveText : styles.chipText}>{category.name}</Text></Pressable>)}
      </ScrollView>
      {loadingCatalog ? <ActivityIndicator color={colors.accent} /> : products.length === 0 ? <Text style={styles.body}>No products in this category.</Text> : products.map((item) =>
        <Pressable accessibilityLabel={`View ${item.name}, ₹${item.price}, ${item.availability ? "available" : "unavailable"}`} accessibilityRole="button" key={item.id} onPress={() => void showProduct(item)} style={styles.row}>
          {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.thumb} /> : <View style={styles.thumb} />}
          <View style={styles.copy}><Text style={styles.title}>{item.name}</Text><Text style={styles.price}>₹{item.price}</Text><Text style={[styles.body, !item.availability && styles.danger]}>{item.availability ? "Available" : "Unavailable"}</Text></View>
        </Pressable>
      )}
      {!!error && <Text style={styles.danger}>{error}</Text>}
    </ScrollView>
  );

  const activeAddress = addresses.find((a) => a.pincode === pincode) || addresses[0];

  return (
    <ScrollView contentContainerStyle={styles.discoveryPage}>
      <View style={styles.header}>
        <View style={styles.headerContext}>
          <Text style={styles.headerEyebrow}>DELIVERY LOCATION</Text>
          <Pressable accessibilityLabel={activeAddress ? `Change delivery location, currently ${activeAddress.label || activeAddress.city}, ${activeAddress.pincode}` : "Add a delivery address"} accessibilityRole="button" onPress={openAddresses} style={({ pressed }) => [styles.locationRow, pressed && styles.pressed]}>
            {loadingAddresses ? (
              <Skeleton style={{ width: 150, height: 24, borderRadius: 6 }} />
            ) : (
              <>
                <Text style={styles.locationTitle} numberOfLines={1}>
                  {activeAddress ? `${activeAddress.label || activeAddress.city} • ${activeAddress.pincode}` : 'Add a delivery address'}
                </Text>
                <View style={styles.locationCaret}><Text style={styles.locationCaretText}>▼</Text></View>
              </>
            )}
          </Pressable>
        </View>
      </View>

      <View style={styles.searchBar}>
        <SearchIcon />
        <Text style={styles.searchBarText}>Search supermarkets</Text>
      </View>

      <View style={styles.discoverySection}>
        <Text style={styles.sectionTitle}>Supermarkets near you</Text>
        <Text style={styles.sectionSubtitle}>Choose a supermarket to start shopping</Text>
        
        {loadingAddresses || loadingStores ? (
          <View style={styles.storesList}>
             <StoreSkeleton />
             <StoreSkeleton />
             <StoreSkeleton />
          </View>
        ) : error ? (
          <View style={styles.messageCard}>
            <Text style={styles.messageTitle}>Oops, something went wrong</Text>
            <Text style={styles.messageBody}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => { if (!addresses.length) loadAddresses(); else loadStores(); }} style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}>
              <Text style={styles.secondaryBtnText}>Try again</Text>
            </Pressable>
          </View>
        ) : addresses.length === 0 ? (
          <View style={styles.messageCard}>
            <Text style={styles.messageTitle}>Where to?</Text>
            <Text style={styles.messageBody}>Add a delivery address to find trusted nearby supermarkets.</Text>
            <Pressable accessibilityRole="button" onPress={openAddresses} style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}>
              <Text style={styles.primaryBtnText}>Add delivery address</Text>
            </Pressable>
          </View>
        ) : stores.length === 0 ? (
          <View style={styles.messageCard}>
            <Text style={styles.messageTitle}>No supermarkets available in this area yet.</Text>
            <Text style={styles.messageBody}>Choose another saved address to check a different delivery area.</Text>
            <Pressable accessibilityRole="button" onPress={openAddresses} style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}>
              <Text style={styles.secondaryBtnText}>Change location</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.storesList}>
            {stores.map((item) => (
              <Pressable accessibilityLabel={`Shop at ${item.name}. ${item.operatingStatus}. Delivery ₹${item.deliveryFee}, minimum order ₹${item.minimumOrderValue}`} accessibilityRole="button" key={item.id} onPress={() => selectStore(item)} style={({ pressed }) => [styles.storeCard, pressed && styles.storeCardPressed]}>
                <View style={styles.storeCardInner}>
                  <View style={styles.storeLogoBox}>
                    {item.logoImageUrl ? (
                      <Image source={{ uri: item.logoImageUrl }} style={styles.storeLogo} />
                    ) : (
                      <View style={styles.storeLogoPlaceholder}>
                        <Text style={styles.storeLogoPlaceholderText}>{item.name.charAt(0).toUpperCase()}</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.storeInfo}>
                    <View style={styles.storeTitleRow}>
                      <Text style={styles.storeName} numberOfLines={1}>{item.name}</Text>
                      <View style={[styles.statusBadge, item.operatingStatus === "CLOSED" && styles.statusBadgeClosed]}>
                        <Text style={[styles.statusBadgeText, item.operatingStatus === "CLOSED" && styles.statusBadgeTextClosed]}>{item.operatingStatus === "OPEN" ? "OPEN" : "CLOSED"}</Text>
                      </View>
                    </View>
                    <Text style={styles.storeMeta}>Delivery ₹{item.deliveryFee} • Min ₹{item.minimumOrderValue}</Text>
                    <Text style={styles.storePincode}>Serving {pincode}</Text>
                  </View>
                </View>
                <View style={styles.storeCardFooter}>
                  <Text style={styles.shopNowText}>Shop Now</Text>
                  <Text style={styles.shopNowArrowText}>→</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  discoveryPage: { width: "100%", maxWidth: 760, alignSelf: "center", paddingTop: Platform.OS === 'web' ? 67 : 24, paddingBottom: 40, backgroundColor: colors.bg, minHeight: '100%' },
  header: { paddingHorizontal: 22, paddingBottom: 16 },
  headerContext: { gap: 4 },
  headerEyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2, color: colors.accent },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 4, maxWidth: "100%" },
  locationTitle: { fontSize: 20, fontWeight: "800", color: colors.ink, flexShrink: 1 },
  locationCaret: { marginTop: 2 },
  locationCaretText: { fontSize: 11, color: colors.accent, fontWeight: "900" },
  
  searchBar: { marginHorizontal: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, flexDirection: "row", alignItems: "center", gap: 12, shadowColor: colors.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 8, elevation: 2, marginBottom: 24 },
  searchIconWrapper: { width: 18, height: 18, position: "relative" },
  searchIconCircle: { width: 13, height: 13, borderRadius: 6.5, borderWidth: 2, borderColor: colors.muted },
  searchIconHandle: { width: 2, height: 6, backgroundColor: colors.muted, transform: [{ rotate: "-45deg" }], position: "absolute", bottom: 1, right: 3, borderRadius: 1 },
  searchBarText: { fontSize: 16, color: colors.muted, fontWeight: "500" },

  discoverySection: { paddingHorizontal: 22, gap: 16 },
  sectionTitle: { fontSize: 22, fontWeight: "800", color: colors.ink },
  sectionSubtitle: { fontSize: 14, lineHeight: 20, color: colors.muted, marginTop: -10, marginBottom: 2 },
  
  storesList: { gap: 16 },
  storeCard: { backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: colors.line, overflow: "hidden", shadowColor: colors.ink, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 3 },
  storeCardPressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  storeCardInner: { flexDirection: "row", padding: 16, gap: 14 },
  storeLogoBox: { width: 68, height: 68, borderRadius: 16, backgroundColor: colors.soft, overflow: "hidden" },
  storeLogo: { width: "100%", height: "100%" },
  storeLogoPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.soft },
  storeLogoPlaceholderText: { fontSize: 28, fontWeight: "800", color: colors.ink },
  storeInfo: { flex: 1, gap: 4, justifyContent: "center" },
  storeTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  storeName: { fontSize: 17, fontWeight: "800", color: colors.ink, flex: 1 },
  statusBadge: { backgroundColor: colors.soft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusBadgeClosed: { backgroundColor: colors.highlight },
  statusBadgeText: { fontSize: 10, fontWeight: "800", color: colors.ink, letterSpacing: 0.5 },
  statusBadgeTextClosed: { color: colors.danger },
  storeMeta: { fontSize: 14, color: colors.muted, fontWeight: "500" },
  storePincode: { fontSize: 12, color: colors.muted },
  storeCardFooter: { borderTopWidth: 1, borderTopColor: colors.line, paddingVertical: 12, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#FAFAFA" },
  shopNowText: { fontSize: 14, fontWeight: "800", color: colors.ink },
  shopNowArrowText: { fontSize: 16, fontWeight: "800", color: colors.ink },

  messageCard: { backgroundColor: colors.card, borderRadius: 20, padding: 24, borderWidth: 1, borderColor: colors.line, alignItems: "center", gap: 12 },
  messageTitle: { fontSize: 18, fontWeight: "800", color: colors.ink, textAlign: "center" },
  messageBody: { fontSize: 15, color: colors.muted, textAlign: "center", lineHeight: 22, marginBottom: 8 },
  primaryBtn: { backgroundColor: colors.ink, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 14, width: "100%", alignItems: "center" },
  primaryBtnText: { color: colors.card, fontWeight: "800", fontSize: 15 },
  secondaryBtn: { backgroundColor: colors.soft, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 14, width: "100%", alignItems: "center" },
  secondaryBtnText: { color: colors.ink, fontWeight: "800", fontSize: 15 },
  
  skeleton: { backgroundColor: colors.line },
  skeletonLogo: { width: 68, height: 68, borderRadius: 16 },
  skeletonTextLong: { height: 18, borderRadius: 4, width: "70%", marginBottom: 2 },
  skeletonTextShort: { height: 14, borderRadius: 4, width: "40%", marginTop: 4 },

  pressed: { opacity: 0.6 },

  page: { paddingTop: Platform.OS === 'web' ? 67 : 24, paddingBottom: 40, paddingHorizontal: 22, gap: 16, backgroundColor: colors.bg },
  hero: { fontSize: 32, lineHeight: 38, fontWeight: "800", color: colors.ink },
  eyebrow: { fontSize: 12, fontWeight: "800", letterSpacing: 1.5, color: colors.accent },
  body: { fontSize: 15, lineHeight: 22, color: colors.muted },
  title: { fontSize: 17, fontWeight: "800", color: colors.ink },
  price: { fontSize: 18, fontWeight: "800", color: colors.ink },
  link: { color: colors.accent, fontWeight: "700", paddingVertical: 8 },
  row: { flexDirection: "row", backgroundColor: colors.card, borderRadius: 16, padding: 14, gap: 14, borderWidth: 1, borderColor: colors.line },
  copy: { flex: 1, gap: 5 },
  thumb: { width: 72, height: 72, borderRadius: 12, backgroundColor: colors.soft },
  heroImage: { width: "100%", height: 260, borderRadius: 18, backgroundColor: colors.soft },
  chip: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, marginRight: 8 },
  chipText: { color: colors.ink, fontWeight: "500" },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipActiveText: { color: colors.card, fontWeight: "700" },
  badge: { alignSelf: "flex-start", fontSize: 12, fontWeight: "800", color: colors.ink, backgroundColor: colors.soft, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10 },
  closed: { backgroundColor: colors.highlight, color: colors.danger },
  danger: { color: colors.danger },
  primary: { backgroundColor: colors.ink, borderRadius: 12, padding: 15, alignItems: "center" },
  primaryText: { color: "#FFFFFF", fontWeight: "800" },
  disabled: { opacity: 0.4 },
});
