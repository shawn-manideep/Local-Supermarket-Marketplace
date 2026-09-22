import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View, Animated, TextInput } from "react-native";
import { customerApi, type CustomerAddress, type CustomerCategory, type CustomerProduct, type CustomerStore } from "./lib/api";
import { colors, radius, spacing, typography, commonStyles, shadows } from "./theme";
import { QuantitySelector } from "./components/QuantitySelector";
import { PlaceholderImage } from "./components/PlaceholderImage";
import { ConfirmationDialog } from "./components/ConfirmationDialog";

function Skeleton({ style }: { style?: any }) {
  const anim = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 800, useNativeDriver: Platform.OS !== "web" }),
      Animated.timing(anim, { toValue: 0.5, duration: 800, useNativeDriver: Platform.OS !== "web" })
    ]));
    animation.start();
    return () => animation.stop();
  }, [anim]);
  return <Animated.View style={[styles.skeleton, style, { opacity: anim }]} />;
}

const StoreSkeleton = () => (
  <View style={styles.storeCard}>
    <View style={styles.storeCardInner}>
      <Skeleton style={styles.skeletonLogo} />
      <View style={styles.storeInfo}>
        <Skeleton style={styles.skeletonTextLong} />
        <Skeleton style={styles.skeletonTextShort} />
        <Skeleton style={styles.skeletonTextShort} />
      </View>
    </View>
  </View>
);

function SearchIcon() {
  return (
    <View style={{ width: 16, height: 16, position: "relative", marginRight: spacing.xs }}>
      <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.muted }} />
      <View style={{ width: 2, height: 6, backgroundColor: colors.muted, transform: [{ rotate: "-45deg" }], position: "absolute", bottom: -2, right: 0, borderRadius: 1 }} />
    </View>
  );
}

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
  
  const [searchQuery, setSearchQuery] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);

  const [switchDialogVisible, setSwitchDialogVisible] = useState(false);
  const [switchDialogLoading, setSwitchDialogLoading] = useState(false);
  const [pendingProduct, setPendingProduct] = useState<{product: CustomerProduct, qty: number} | null>(null);

  const discoveryGeneration = useRef(0);
  const catalogGeneration = useRef(0);

  const filteredStores = useMemo(() => stores.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase())), [stores, searchQuery]);
  const filteredProducts = useMemo(() => products.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase())), [products, searchQuery]);

  const clearCatalog = () => {
    ++catalogGeneration.current;
    setCategories([]); setProducts([]); setProduct(null); setCategoryId(""); setSearchQuery("");
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
    setLoadingStores(true); setError(""); setStore(null); clearCatalog();
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
      if (generation === catalogGeneration.current) setError(reason instanceof Error ? reason.message : "Unable to load catalog.");
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
    setLoadingCatalog(true); setProduct(null); setError(""); setQuantity(1);
    try {
      const result = await customerApi<{ product: CustomerProduct }>(`/api/customer/stores/${store.id}/products/${selected.id}?pincode=${pincode}`);
      if (generation === catalogGeneration.current) setProduct(result.product);
    } catch (reason) { if (generation === catalogGeneration.current) setError(reason instanceof Error ? reason.message : "Unable to load product."); }
    finally { if (generation === catalogGeneration.current) setLoadingCatalog(false); }
  };

  const addToCart = async (selected: CustomerProduct, qty: number, confirmStoreSwitch = false) => {
    if (adding && !confirmStoreSwitch) return;
    setAdding(true);
    try {
      await customerApi("/api/customer/cart/items", { method:"POST", body:JSON.stringify({ productId:selected.id, quantity:qty, confirmStoreSwitch }) });
      openCart();
    } catch (reason) {
      const errorMsg = reason instanceof Error ? reason.message : "Unable to add product.";
      if (errorMsg === "Store switch required") {
        setPendingProduct({ product: selected, qty });
        setSwitchDialogVisible(true);
      } else {
        setError(errorMsg);
      }
    } finally { 
      setAdding(false); 
    }
  };

  const confirmSwitchCart = async () => {
    if (!pendingProduct) return;
    setSwitchDialogLoading(true);
    try {
      await customerApi("/api/customer/cart/items", { method:"POST", body:JSON.stringify({ productId: pendingProduct.product.id, quantity: pendingProduct.qty, confirmStoreSwitch: true }) });
      setSwitchDialogVisible(false);
      setPendingProduct(null);
      openCart();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to add product.");
      setSwitchDialogVisible(false);
      setPendingProduct(null);
    } finally {
      setSwitchDialogLoading(false);
    }
  };

  let content;

  if (product && store) {
    content = (
      <ScrollView contentContainerStyle={commonStyles.page}>
        <View style={commonStyles.container}>
          <Pressable accessibilityLabel={`Back to ${store.name}`} accessibilityRole="button" onPress={() => { ++catalogGeneration.current; setProduct(null); }} style={styles.backBtn}>
            <Text style={styles.backText}>← Back to {store.name}</Text>
          </Pressable>
          
          <View style={styles.productHero}>
            {product.imageUrl ? <Image source={{ uri: product.imageUrl }} style={styles.heroImage} resizeMode="cover" /> : <PlaceholderImage name={product.name} style={styles.heroImage} />}
            <View style={[styles.badge, !product.availability && styles.closed]}>
              <Text style={[styles.badgeText, !product.availability && styles.closedText]}>{product.availability ? "In Stock" : "Out of Stock"}</Text>
            </View>
          </View>

          <Text style={typography.hero}>{product.name}</Text>
          <Text style={[typography.title1, { color: colors.accent, marginTop: spacing.xs }]}>₹{product.price}</Text>
          <Text style={[typography.body, { marginTop: spacing.md, marginBottom: spacing.xl }]}>{product.description ?? "A fresh selection from your local supermarket."}</Text>
          
          {product.availability && (
            <View style={styles.qtyRow}>
              <Text style={typography.title3}>Quantity</Text>
              <QuantitySelector quantity={quantity} onDecrease={() => setQuantity(q => Math.max(1, q - 1))} onIncrease={() => setQuantity(q => q + 1)} min={1} disabled={adding} />
            </View>
          )}

          {!!error && <Text style={[typography.caption, { color: colors.danger, marginBottom: spacing.md }]}>{error}</Text>}

          <Pressable accessibilityRole="button" disabled={!product.availability || adding} onPress={() => void addToCart(product, quantity)} style={[styles.primaryBtn, (!product.availability || adding) && styles.disabled]}>
            {adding ? <ActivityIndicator color={colors.card} /> : <Text style={styles.primaryBtnText}>{product.availability ? `Add ${quantity} to Cart` : "Unavailable"}</Text>}
          </Pressable>
        </View>
      </ScrollView>
    );
  } else if (store) {
    content = (
      <ScrollView contentContainerStyle={commonStyles.page}>
        <View style={commonStyles.container}>
          <Pressable accessibilityLabel="Change supermarket" accessibilityRole="button" onPress={() => selectStore(null)} style={styles.backBtn}>
            <Text style={styles.backText}>← All Supermarkets</Text>
          </Pressable>
          
          <View style={{ marginBottom: spacing.xl }}>
            <Text style={typography.eyebrow}>{store.operatingStatus}</Text>
            <Text style={typography.hero}>{store.name}</Text>
            <Text style={typography.body}>{store.description ?? `Delivery ₹${store.deliveryFee} • Min Order ₹${store.minimumOrderValue}`}</Text>
          </View>

          <View style={styles.searchBar}>
            <SearchIcon />
            <TextInput style={styles.searchInput} placeholder="Search products..." placeholderTextColor={colors.muted} value={searchQuery} onChangeText={setSearchQuery} />
          </View>

          {!searchQuery && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: spacing.md, marginHorizontal: -spacing.lg }} contentContainerStyle={{ paddingHorizontal: spacing.lg }}>
              <Pressable accessibilityRole="button" onPress={() => void filterProducts("")} style={[styles.chip, !categoryId && styles.chipActive]}>
                <Text style={!categoryId ? styles.chipActiveText : styles.chipText}>All Products</Text>
              </Pressable>
              {categories.map((category) => (
                <Pressable accessibilityRole="button" key={category.id} onPress={() => void filterProducts(category.id)} style={[styles.chip, categoryId === category.id && styles.chipActive]}>
                  <Text style={categoryId === category.id ? styles.chipActiveText : styles.chipText}>{category.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {loadingCatalog ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} /> : filteredProducts.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={typography.title3}>No products found</Text>
              <Text style={typography.body}>Try adjusting your search or category.</Text>
            </View>
          ) : (
            <View style={styles.productGrid}>
              {filteredProducts.map((item) => (
                <Pressable accessibilityRole="button" key={item.id} onPress={() => void showProduct(item)} style={styles.productCard}>
                  {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.productThumb} /> : <PlaceholderImage name={item.name} style={styles.productThumb} />}
                  <View style={styles.productInfo}>
                    <Text style={typography.bodySemibold} numberOfLines={2}>{item.name}</Text>
                    <Text style={[typography.title3, { color: colors.accent }]}>₹{item.price}</Text>
                    {!item.availability && <Text style={[typography.caption, { color: colors.danger }]}>Out of Stock</Text>}
                  </View>
                  {item.availability && (
                    <Pressable accessibilityRole="button" onPress={(e: any) => { e?.stopPropagation?.(); void addToCart(item, 1); }} style={styles.addMiniBtn}>
                      <Text style={styles.addMiniBtnText}>+</Text>
                    </Pressable>
                  )}
                </Pressable>
              ))}
            </View>
          )}
          {!!error && <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.md }]}>{error}</Text>}
        </View>
      </ScrollView>
    );
  } else {
    const activeAddress = addresses.find((a) => a.pincode === pincode) || addresses[0];

    content = (
      <ScrollView contentContainerStyle={commonStyles.page}>
        <View style={commonStyles.container}>
          <View style={styles.header}>
            <Text style={typography.eyebrow}>DELIVERING TO</Text>
            <Pressable accessibilityRole="button" onPress={openAddresses} style={styles.locationRow}>
              {loadingAddresses ? <Skeleton style={{ width: 150, height: 24, borderRadius: 6 }} /> : (
                <>
                  <Text style={typography.title2} numberOfLines={1}>{activeAddress ? `${activeAddress.label || activeAddress.city} • ${activeAddress.pincode}` : 'Add Delivery Address'}</Text>
                  <Text style={{ color: colors.accent, fontSize: 12 }}>▼</Text>
                </>
              )}
            </Pressable>
          </View>

          <View style={[styles.searchBar, { marginBottom: spacing.xl }]}>
            <SearchIcon />
            <TextInput style={styles.searchInput} placeholder="Search supermarkets..." placeholderTextColor={colors.muted} value={searchQuery} onChangeText={setSearchQuery} />
          </View>

          <Text style={[typography.title1, { marginBottom: spacing.xs }]}>Fresh Near You</Text>
          <Text style={[typography.body, { marginBottom: spacing.lg }]}>Choose a local supermarket to shop fresh groceries.</Text>
          
          {loadingAddresses || loadingStores ? (
            <View style={{ gap: spacing.lg }}><StoreSkeleton /><StoreSkeleton /></View>
          ) : error ? (
            <View style={styles.emptyState}>
              <Text style={typography.title2}>Something went wrong</Text>
              <Text style={typography.body}>{error}</Text>
              <Pressable onPress={() => { if (!addresses.length) loadAddresses(); else loadStores(); }} style={styles.primaryBtn}><Text style={styles.primaryBtnText}>Try Again</Text></Pressable>
            </View>
          ) : addresses.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={typography.title2}>Where to?</Text>
              <Text style={typography.body}>Add a delivery address to find trusted nearby supermarkets.</Text>
              <Pressable onPress={openAddresses} style={styles.primaryBtn}><Text style={styles.primaryBtnText}>Add Address</Text></Pressable>
            </View>
          ) : filteredStores.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={typography.title2}>No supermarkets found</Text>
              <Text style={typography.body}>{searchQuery ? "Try a different search term." : "We don't serve this area yet. Try another address."}</Text>
              {!searchQuery && <Pressable onPress={openAddresses} style={styles.secondaryBtn}><Text style={styles.secondaryBtnText}>Change Location</Text></Pressable>}
            </View>
          ) : (
            <View style={{ gap: spacing.lg }}>
              {filteredStores.map((item) => (
                <Pressable accessibilityRole="button" key={item.id} onPress={() => selectStore(item)} style={styles.storeCard}>
                  <View style={styles.storeCardInner}>
                    {item.logoImageUrl ? <Image source={{ uri: item.logoImageUrl }} style={styles.storeLogo} /> : <PlaceholderImage name={item.name} style={styles.storeLogo} />}
                    <View style={styles.storeInfo}>
                      <Text style={typography.title3} numberOfLines={1}>{item.name}</Text>
                      <Text style={typography.caption}>Delivery ₹{item.deliveryFee} • Min ₹{item.minimumOrderValue}</Text>
                      <Text style={typography.caption}>Serving {pincode}</Text>
                    <Text style={styles.shopNowText}>Shop now →</Text>
                    </View>
                    <View style={[styles.statusBadge, item.operatingStatus === "CLOSED" && styles.statusBadgeClosed]}>
                      <Text style={[styles.statusBadgeText, item.operatingStatus === "CLOSED" && styles.statusBadgeTextClosed]}>{item.operatingStatus}</Text>
                    </View>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    );
  }

  return (
    <>
      {content}
      <ConfirmationDialog
        visible={switchDialogVisible}
        title="Start a New Basket?"
        message="Your basket contains items from another supermarket. Would you like to clear it and start a new basket here?"
        confirmLabel="Start New Basket"
        isDestructive
        loading={switchDialogLoading}
        onConfirm={confirmSwitchCart}
        onCancel={() => {
          if (!switchDialogLoading) {
            setSwitchDialogVisible(false);
            setPendingProduct(null);
          }
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: spacing.lg },
  locationRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  searchBar: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, paddingHorizontal: spacing.md, height: 52, ...shadows.sm },
  searchInput: { flex: 1, height: "100%", marginLeft: spacing.xs, ...typography.bodySemibold, color: colors.ink },
  storeCard: { backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.line, padding: spacing.md, ...shadows.sm },
  storeCardInner: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  storeLogo: { width: 72, height: 72, borderRadius: radius.lg },
  storeInfo: { flex: 1, gap: 2 },
  statusBadge: { backgroundColor: colors.soft, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm, alignSelf: "flex-start" },
  statusBadgeClosed: { backgroundColor: colors.highlight },
  statusBadgeText: { fontSize: 10, fontWeight: "800", color: colors.ink },
  statusBadgeTextClosed: { color: colors.danger },
  shopNowText: { ...typography.bodySemibold, color: colors.accent, marginTop: spacing.xs },
  skeleton: { backgroundColor: colors.line },
  skeletonLogo: { width: 72, height: 72, borderRadius: radius.lg },
  skeletonTextLong: { height: 16, borderRadius: 4, width: "80%", marginBottom: 4 },
  skeletonTextShort: { height: 12, borderRadius: 4, width: "50%", marginTop: 4 },
  emptyState: { alignItems: "center", padding: spacing.xl, backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.line, gap: spacing.md, marginTop: spacing.lg },
  primaryBtn: { backgroundColor: colors.ink, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md, width: "100%", alignItems: "center" },
  primaryBtnText: { ...typography.bodySemibold, color: colors.card },
  secondaryBtn: { backgroundColor: colors.soft, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md, width: "100%", alignItems: "center" },
  secondaryBtnText: { ...typography.bodySemibold, color: colors.ink },
  backBtn: { paddingVertical: spacing.sm, marginBottom: spacing.sm, alignSelf: "flex-start" },
  backText: { ...typography.bodySemibold, color: colors.accent },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, marginRight: spacing.sm },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { ...typography.bodySemibold, color: colors.ink },
  chipActiveText: { ...typography.bodySemibold, color: colors.card },
  productGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginHorizontal: -spacing.xs },
  productCard: { width: "48%", backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: spacing.sm, marginBottom: spacing.md, ...shadows.sm },
  productThumb: { width: "100%", aspectRatio: 1, borderRadius: radius.md, marginBottom: spacing.sm },
  productInfo: { gap: spacing.xs, marginBottom: spacing.xl },
  addMiniBtn: { position: "absolute", bottom: spacing.sm, right: spacing.sm, width: 32, height: 32, borderRadius: 16, backgroundColor: colors.soft, justifyContent: "center", alignItems: "center", zIndex: 2 },
  addMiniBtnText: { color: colors.ink, fontSize: 18, fontWeight: "600", marginTop: -2 },
  productHero: { position: "relative", marginBottom: spacing.lg },
  heroImage: { width: "100%", height: 300, borderRadius: radius.xl },
  badge: { position: "absolute", top: spacing.md, left: spacing.md, backgroundColor: colors.card, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, ...shadows.sm },
  closed: { backgroundColor: colors.highlight },
  badgeText: { ...typography.caption, color: colors.ink, fontWeight: "800" },
  closedText: { color: colors.danger },
  qtyRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, marginBottom: spacing.xl },
  disabled: { opacity: 0.5 },
});