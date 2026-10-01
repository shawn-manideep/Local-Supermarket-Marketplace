import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View, Animated, TextInput } from "react-native";
import { customerApi, type CustomerAddress, type CustomerCategory, type CustomerProduct, type CustomerProductPagination, type CustomerProductSearchResponse, type CustomerProductVariant, type CustomerStore, type CustomerProfile } from "./lib/api";
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

function PaginationControls({ pagination, onPageChange }: { pagination: CustomerProductPagination | null; onPageChange: (page: number) => void }) {
  if (!pagination) return null;
  const pages = Math.ceil(pagination.total / pagination.pageSize);
  return (
    <View style={styles.pagination}>
      <Text style={typography.caption}>
        {pagination.total === 0 ? "No products" : `Showing ${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(pagination.page * pagination.pageSize, pagination.total)} of ${pagination.total}`}
      </Text>
      {pages > 1 && <>
        <Pressable accessibilityRole="button" disabled={pagination.page <= 1} onPress={() => onPageChange(pagination.page - 1)} style={[styles.pageButton, pagination.page <= 1 && styles.disabled]}>
          <Text style={styles.pageButtonText}>Previous</Text>
        </Pressable>
        <Text style={typography.caption}>Page {pagination.page} of {pages}</Text>
        <Pressable accessibilityRole="button" disabled={pagination.page >= pages} onPress={() => onPageChange(pagination.page + 1)} style={[styles.pageButton, pagination.page >= pages && styles.disabled]}>
          <Text style={styles.pageButtonText}>Next</Text>
        </Pressable>
      </>}
    </View>
  );
}

function SearchIcon() {
  return (
    <View style={{ width: 16, height: 16, position: "relative", marginRight: spacing.xs }}>
      <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.muted }} />
      <View style={{ width: 2, height: 6, backgroundColor: colors.muted, transform: [{ rotate: "-45deg" }], position: "absolute", bottom: -2, right: 0, borderRadius: 1 }} />
    </View>
  );
}

function customerVariantLabel(variant: CustomerProductVariant) {
  const quantityValue = Number(variant.quantityValue);
  const quantity = Number.isFinite(quantityValue)
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(quantityValue)
    : variant.quantityValue;
  const unit = variant.quantityUnit === "l" ? "L" : variant.quantityUnit;
  const displayUnit = unit === "piece" && quantityValue !== 1 ? "pieces" : unit;
  return `${quantity} ${displayUnit}`;
}

function canPurchaseVariant(product: CustomerProduct, variant: CustomerProductVariant) {
  return product.availability
    && product.purchasable
    && variant.isActive
    && variant.availability
    && variant.purchasable
    && Number(variant.price) > 0;
}

function variantAvailabilityLabel(product: CustomerProduct, variant: CustomerProductVariant) {
  if (!product.availability || !variant.availability || Number(variant.price) <= 0) return "Unavailable";
  return canPurchaseVariant(product, variant) ? "Available" : "Out of stock";
}

function productAvailabilityLabel(product: CustomerProduct) {
  if (!product.availability) return "Unavailable";
  if (product.purchasable) return "In Stock";
  const configuredForSale = (product.variants ?? []).some((variant) =>
    variant.isActive && variant.availability && Number(variant.price) > 0,
  );
  return configuredForSale ? "Out of Stock" : "Unavailable";
}

export function MarketplaceScreen({ openAddresses, openCart, resetToken, onCartUnitsChange }: { openAddresses: () => void; openCart: () => void; resetToken: number; onCartUnitsChange?: (count: number) => void }) {
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [pincode, setPincode] = useState("");
  const [stores, setStores] = useState<CustomerStore[]>([]);
  const [homeCategories, setHomeCategories] = useState<CustomerCategory[]>([]);
  const [store, setStore] = useState<CustomerStore | null>(null);
  const [categories, setCategories] = useState<CustomerCategory[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [products, setProducts] = useState<CustomerProduct[]>([]);
  const [storePagination, setStorePagination] = useState<CustomerProductPagination | null>(null);
  const [globalProducts, setGlobalProducts] = useState<CustomerProduct[]>([]);
  const [globalPagination, setGlobalPagination] = useState<CustomerProductPagination | null>(null);
  const [globalPage, setGlobalPage] = useState(1);
  const [storePage, setStorePage] = useState(1);
  const [loadingGlobalProducts, setLoadingGlobalProducts] = useState(false);
  const [product, setProduct] = useState<CustomerProduct | null>(null);
  
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [loadingStores, setLoadingStores] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [error, setError] = useState("");
  
  const [searchQuery, setSearchQuery] = useState("");
  const [storeSearchQuery, setStoreSearchQuery] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [adding, setAdding] = useState(false);
  const [addedNotice, setAddedNotice] = useState("");
  const [cartUnits, setCartUnits] = useState(0);

  const [switchDialogVisible, setSwitchDialogVisible] = useState(false);
  const [switchDialogLoading, setSwitchDialogLoading] = useState(false);
  const [pendingProduct, setPendingProduct] = useState<{product: CustomerProduct, variant: CustomerProductVariant, qty: number} | null>(null);

  const discoveryGeneration = useRef(0);
  const catalogGeneration = useRef(0);
  const globalSearchGeneration = useRef(0);
  const pendingCategoryId = useRef("");
  const cartAddInFlight = useRef(false);

  const filteredStores = useMemo(() => stores.filter(s => s.name.toLowerCase().includes(storeSearchQuery.toLowerCase())), [stores, storeSearchQuery]);

  const clearCatalog = () => {
    ++catalogGeneration.current;
    setCategories([]); setProducts([]); setStorePagination(null); setProduct(null); setCategoryId(""); setSearchQuery("");
    setGlobalProducts([]); setGlobalPagination(null); setGlobalPage(1); setStorePage(1);
  };

  const selectStore = (nextStore: CustomerStore | null) => {
    pendingCategoryId.current = "";
    clearCatalog();
    setError("");
    if (!nextStore) setLoadingCatalog(false);
    setStore(nextStore);
  };

  useEffect(() => {
    if (resetToken > 0) selectStore(null);
  }, [resetToken]);

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
  const refreshCart = useCallback(async () => {
    try {
      const result = await customerApi<{ cart: { items: Array<{ quantity: number }> } | null }>("/api/customer/cart");
      const count = result.cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
      setCartUnits(count);
      onCartUnitsChange?.(count);
    } catch { /* Shopping remains available if cart summary refresh fails. */ }
  }, [onCartUnitsChange]);
  useEffect(() => { void refreshCart(); }, [refreshCart]);
  useEffect(() => {
    let active = true;
    customerApi<{ profile: CustomerProfile }>("/api/customer/profile")
      .then(({ profile }) => { if (active) setCustomerName(profile.fullName?.split(" ")[0] ?? ""); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

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
    const firstStore = stores[0];
    if (!firstStore || !pincode) { setHomeCategories([]); return; }
    let active = true;
    customerApi<{ categories: CustomerCategory[] }>(`/api/customer/stores/${firstStore.id}/categories?pincode=${pincode}`)
      .then(result => { if (active) setHomeCategories(result.categories); })
      .catch(() => { if (active) setHomeCategories([]); });
    return () => { active = false; };
  }, [stores, pincode]);

  useEffect(() => {
    if (!store) return;
    const generation = ++catalogGeneration.current;
    const nextCategoryId = pendingCategoryId.current || categoryId;
    pendingCategoryId.current = "";
    if (nextCategoryId !== categoryId) setCategoryId(nextCategoryId);
    setLoadingCatalog(true); setError(""); setCategories([]); setProducts([]);
    const productQuery = new URLSearchParams({ pincode, page: String(storePage), pageSize: "24" });
    if (nextCategoryId) productQuery.set("categoryId", nextCategoryId);
    Promise.all([
      customerApi<{ categories: CustomerCategory[] }>(`/api/customer/stores/${store.id}/categories?pincode=${pincode}`),
      customerApi<CustomerProductSearchResponse>(`/api/customer/stores/${store.id}/products?${productQuery}`),
    ]).then(([categoryResult, productResult]) => {
      if (generation === catalogGeneration.current) {
        setCategories(categoryResult.categories);
        setProducts(productResult.products);
        setStorePagination(productResult.pagination);
         pendingCategoryId.current = "";
      }
    }).catch((reason) => {
      if (generation === catalogGeneration.current) setError(reason instanceof Error ? reason.message : "Unable to load catalog.");
    }).finally(() => { if (generation === catalogGeneration.current) setLoadingCatalog(false); });
  }, [store, pincode, categoryId, storePage]);

  useEffect(() => {
    const search = searchQuery.trim();
    if (!pincode || !search) {
      ++globalSearchGeneration.current;
      setGlobalProducts([]);
      setGlobalPagination(null);
      setLoadingGlobalProducts(false);
      return;
    }
    const generation = ++globalSearchGeneration.current;
    setGlobalProducts([]);
    setGlobalPagination(null);
    setLoadingGlobalProducts(true);
    setError("");
    const timer = setTimeout(() => {
      const query = new URLSearchParams({
        pincode,
        search,
        page: String(globalPage),
        pageSize: "24",
      });
      customerApi<CustomerProductSearchResponse>(`/api/customer/products?${query}`)
        .then((result) => {
          if (generation === globalSearchGeneration.current) {
            setGlobalProducts(result.products);
            setGlobalPagination(result.pagination);
          }
        })
        .catch((reason) => {
          if (generation === globalSearchGeneration.current) setError(reason instanceof Error ? reason.message : "Unable to search products.");
        })
        .finally(() => {
          if (generation === globalSearchGeneration.current) setLoadingGlobalProducts(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [pincode, searchQuery, globalPage]);

  const filterProducts = async (nextCategoryId: string) => {
    if (!store) return;
    setCategoryId(nextCategoryId);
    setStorePage(1);
    setProduct(null);
    setError("");
  };

  const selectGlobalOffer = async (offer: CustomerProduct) => {
    const generation = ++catalogGeneration.current;
    setLoadingCatalog(true);
    setError("");
    try {
      const [storeResult, categoriesResult, productResult] = await Promise.all([
        customerApi<{ store: CustomerStore }>(`/api/customer/stores/${offer.storeId}?pincode=${pincode}`),
        customerApi<{ categories: CustomerCategory[] }>(`/api/customer/stores/${offer.storeId}/categories?pincode=${pincode}`),
        customerApi<{ product: CustomerProduct }>(`/api/customer/stores/${offer.storeId}/products/${offer.id}?pincode=${pincode}`),
      ]);
      if (generation === catalogGeneration.current) {
        setStore(storeResult.store);
        setCategories(categoriesResult.categories);
        setCategoryId(productResult.product.categoryId ?? "");
        setStorePage(1);
        setProducts([]);
        setStorePagination(null);
        setProduct(productResult.product);
        setSearchQuery("");
        setGlobalProducts([]);
        const firstAvailable = productResult.product.availability && productResult.product.purchasable
          ? productResult.product.variants?.find((variant) => canPurchaseVariant(productResult.product, variant))
          : undefined;
        setSelectedVariantId(firstAvailable?.id ?? "");
        setQuantity(1);
      }
    } catch (reason) {
      if (generation === catalogGeneration.current) setError(reason instanceof Error ? reason.message : "Unable to open this product.");
    } finally {
      if (generation === catalogGeneration.current) setLoadingCatalog(false);
    }
  };

  const showProduct = async (selected: CustomerProduct) => {
    if (!store) return;
    const generation = ++catalogGeneration.current;
    setLoadingCatalog(true); setProduct(null); setError(""); setQuantity(1);
    try {
      const result = await customerApi<{ product: CustomerProduct }>(`/api/customer/stores/${store.id}/products/${selected.id}?pincode=${pincode}`);
      if (generation === catalogGeneration.current) {
        setProduct(result.product);
        const firstAvailable = result.product.variants?.find((variant) => canPurchaseVariant(result.product, variant));
        setSelectedVariantId(firstAvailable?.id ?? "");
      }
    } catch (reason) { if (generation === catalogGeneration.current) setError(reason instanceof Error ? reason.message : "Unable to load product."); }
    finally { if (generation === catalogGeneration.current) setLoadingCatalog(false); }
  };

  const addToCart = async (selected: CustomerProduct, variant: CustomerProductVariant, qty: number, confirmStoreSwitch = false) => {
    if (!canPurchaseVariant(selected, variant)) {
      setError("This option is currently unavailable.");
      return;
    }
    if (cartAddInFlight.current) return;
    cartAddInFlight.current = true;
    setAdding(true);
    try {
      await customerApi("/api/customer/cart/items", { method:"POST", body:JSON.stringify({ productId:selected.id, variantId:variant.id, quantity:qty, confirmStoreSwitch }) });
      setAddedNotice(`${selected.name} · ${variant.name} added to cart`);
      setTimeout(() => setAddedNotice(""), 2600);
      void refreshCart();
    } catch (reason) {
      const errorMsg = reason instanceof Error ? reason.message : "Unable to add product.";
      if (errorMsg === "Store switch required") {
        setPendingProduct({ product: selected, variant, qty });
        setSwitchDialogVisible(true);
      } else {
        setError(errorMsg);
      }
    } finally { 
      cartAddInFlight.current = false;
      setAdding(false); 
    }
  };

  const confirmSwitchCart = async () => {
    if (!pendingProduct || cartAddInFlight.current) return;
    cartAddInFlight.current = true;
    setSwitchDialogLoading(true);
    try {
      await customerApi("/api/customer/cart/items", { method:"POST", body:JSON.stringify({ productId: pendingProduct.product.id, variantId: pendingProduct.variant.id, quantity: pendingProduct.qty, confirmStoreSwitch: true }) });
      setSwitchDialogVisible(false);
      setAddedNotice(`${pendingProduct.product.name} · ${pendingProduct.variant.name} added to cart`);
      setTimeout(() => setAddedNotice(""), 2600);
      setPendingProduct(null);
      void refreshCart();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to add product.");
      setSwitchDialogVisible(false);
      setPendingProduct(null);
    } finally {
      cartAddInFlight.current = false;
      setSwitchDialogLoading(false);
    }
  };

  const productSearchField = (placeholder: string) => (
    <View style={[styles.searchBar, { marginTop: spacing.lg }]}>
      <SearchIcon />
      <TextInput
        accessibilityLabel="Search products across nearby stores"
        style={styles.searchInput}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        value={searchQuery}
        onChangeText={(value) => { setSearchQuery(value); setGlobalPage(1); }}
      />
    </View>
  );

  let content;

  if (searchQuery.trim() && pincode) {
    content = (
      <ScrollView key="global-product-search" contentContainerStyle={commonStyles.page}>
        <View style={commonStyles.container}>
          <View style={styles.storeHeading}>
            <View style={styles.storeAvatar}><Text style={styles.storeAvatarText}>⌕</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={typography.title2}>Search all nearby stores</Text>
              <Text style={typography.caption}>Available listings serving {pincode}</Text>
            </View>
            {!!store && <Pressable accessibilityRole="button" onPress={() => setSearchQuery("")}><Text style={styles.backText}>Back to {store.name}</Text></Pressable>}
          </View>
          {productSearchField("Search groceries across nearby stores...")}
          {!!error && <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.md }]}>{error}</Text>}
          {loadingGlobalProducts ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} /> : globalProducts.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={typography.title3}>No products found</Text>
              <Text style={typography.body}>{searchQuery.trim() ? "Try another product, brand, or search term." : "Start typing to search products."}</Text>
            </View>
          ) : (
            <>
              <Text style={[typography.title3, { marginVertical: spacing.md }]}>{globalPagination?.total ?? globalProducts.length} matching store offers</Text>
              <View style={styles.productGrid}>
                {globalProducts.map((item) => {
                  const availableVariants = (item.variants ?? []).filter((variant) => variant.isActive).sort((a, b) => Number(a.price) - Number(b.price));
                  const displayedPrice = availableVariants[0]?.price ?? item.price;
                  return <Pressable accessibilityRole="button" key={`${item.storeId}:${item.id}`} onPress={() => void selectGlobalOffer(item)} style={styles.productCard}>
                    {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.productThumb} /> : <PlaceholderImage name={item.name} style={styles.productThumb} />}
                    <View style={styles.productInfo}>
                      <Text style={typography.bodySemibold} numberOfLines={2}>{item.name}</Text>
                      {!!item.brand && <Text style={typography.caption} numberOfLines={1}>{item.brand}</Text>}
                      <Text style={typography.caption} numberOfLines={1}>{item.storeName} · {item.categoryName ?? "Groceries"}</Text>
                      <Text style={[typography.title3, { color: colors.ink }]}>{availableVariants.length > 1 ? "From " : ""}₹{displayedPrice}</Text>
                      {!item.purchasable && <Text style={[typography.caption, { color: colors.danger }]}>{productAvailabilityLabel(item)}</Text>}
                    </View>
                  </Pressable>;
                })}
              </View>
              <PaginationControls pagination={globalPagination} onPageChange={setGlobalPage} />
            </>
          )}
        </View>
      </ScrollView>
    );
  } else if (product && store) {
    const activeVariants = (product.variants ?? []).filter((variant) => variant.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
    const selectedVariant = activeVariants.find((variant) => variant.id === selectedVariantId);
    const purchasable = !!selectedVariant && canPurchaseVariant(product, selectedVariant);
    const productStatus = productAvailabilityLabel(product);
    content = (
      <ScrollView key="product-detail" contentContainerStyle={commonStyles.page}>
        <View style={commonStyles.container}>
          <Pressable accessibilityLabel={`Back to ${store.name}`} accessibilityRole="button" onPress={() => { ++catalogGeneration.current; setProduct(null); }} style={styles.backBtn}>
            <Text style={styles.backText}>← Back to {store.name}</Text>
          </Pressable>
          
          <View style={styles.productHero}>
            {product.imageUrl ? <Image source={{ uri: product.imageUrl }} style={styles.heroImage} resizeMode="cover" /> : <PlaceholderImage name={product.name} style={styles.heroImage} />}
            <View style={[styles.badge, !product.purchasable && styles.closed]}>
              <Text style={[styles.badgeText, !product.purchasable && styles.closedText]}>{productStatus}</Text>
            </View>
          </View>

          <Text style={typography.hero}>{product.name}</Text>
          <Text style={[typography.title1, { color: colors.accent, marginTop: spacing.xs }]}>₹{selectedVariant?.price ?? product.price}</Text>
          {!!product.description && <Text style={[typography.body, { marginTop: spacing.md, marginBottom: spacing.xl }]}>{product.description}</Text>}
          {activeVariants.length > 1 && <View style={styles.variantSection}>
            <Text style={[typography.title3, { marginBottom: spacing.sm }]}>Select Quantity / Options</Text>
            <View style={{ gap: spacing.sm }}>
              {activeVariants.map((variant) => {
                const available = canPurchaseVariant(product, variant);
                const availabilityLabel = variantAvailabilityLabel(product, variant);
                const selected = selectedVariantId === variant.id;
                return <Pressable key={variant.id} accessibilityRole="radio" accessibilityLabel={`${customerVariantLabel(variant)} · ₹${variant.price} · ${availabilityLabel}`} accessibilityState={{ selected, disabled: !available }} disabled={!available} onPress={() => { if (available) setSelectedVariantId(variant.id); }} style={[styles.variantOption, selected && styles.variantOptionSelected, !available && styles.variantUnavailable]}>
                  <View style={[styles.radio, selected && styles.radioSelected]}>{selected && <View style={styles.radioDot} />}</View>
                  <Text style={[typography.bodySemibold, { flex: 1 }, !available && { color: colors.muted }]}>{customerVariantLabel(variant)} · {availabilityLabel}</Text>
                  <Text style={[typography.bodySemibold, { color: colors.accent }]}>₹{variant.price}</Text>
                </Pressable>;
              })}
            </View>
          </View>}
          {activeVariants.length === 1 && <Text style={[typography.caption, { marginTop: spacing.sm }]}>{customerVariantLabel(activeVariants[0])} · {variantAvailabilityLabel(product, activeVariants[0])}</Text>}
          {activeVariants.length === 0 && <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.md }]}>No active variants are available.</Text>}
          
          {purchasable && (
            <View style={styles.qtyRow}>
              <Text style={typography.title3}>Quantity</Text>
              <QuantitySelector quantity={quantity} onDecrease={() => setQuantity(q => Math.max(1, q - 1))} onIncrease={() => setQuantity(q => q + 1)} min={1} disabled={adding} />
            </View>
          )}

          {!!error && <Text style={[typography.caption, { color: colors.danger, marginBottom: spacing.md }]}>{error}</Text>}

          <Pressable accessibilityRole="button" disabled={!purchasable || adding} onPress={() => selectedVariant && void addToCart(product, selectedVariant, quantity)} style={[styles.primaryBtn, (!purchasable || adding) && styles.disabled]}>
            {adding ? <ActivityIndicator color={colors.card} /> : <Text style={styles.primaryBtnText}>{purchasable ? `Add ${quantity} to Cart` : "Unavailable"}</Text>}
          </Pressable>
        </View>
      </ScrollView>
    );
  } else if (store) {
    content = (
      <ScrollView key={`store-${store.id}-${categoryId}`} contentContainerStyle={commonStyles.page}>
        <View style={commonStyles.container}>
          <View style={styles.storeHero}>
            {store.logoImageUrl ? <Image source={{ uri: store.logoImageUrl }} style={styles.storeHeroImage} /> : <PlaceholderImage name={store.name} style={styles.storeHeroImage} />}
            <Pressable accessibilityLabel="Change supermarket" accessibilityRole="button" onPress={() => selectStore(null)} style={styles.heroBack}><Text style={styles.heroBackText}>‹</Text></Pressable>
            <Text style={styles.heroName}>{store.name}</Text>
          </View>
          <View style={styles.storeHeading}>
            <View style={styles.storeAvatar}><Text style={styles.storeAvatarText}>{store.name.charAt(0).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}><Text style={typography.title2}>{store.name}</Text><Text style={typography.caption}>{store.description ?? `Delivery ₹${store.deliveryFee} · Min ₹${store.minimumOrderValue}`}</Text><Text style={styles.openText}>{store.operatingStatus === "OPEN" ? "Open" : "Closed"} · Serves {pincode}</Text></View>
          </View>
          {productSearchField("Search products across all nearby stores...")}

          {!!categoryId && <View style={styles.categoryHeader}><Pressable onPress={() => void filterProducts("")}><Text style={styles.categoryHeaderText}>‹</Text></Pressable><Text style={styles.categoryHeaderTitle}>{categories.find(c => c.id === categoryId)?.name ?? "Products"}</Text></View>}

          {(
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: spacing.md, marginHorizontal: -spacing.lg }} contentContainerStyle={{ paddingHorizontal: spacing.lg }}>
              <Pressable accessibilityRole="button" onPress={() => void filterProducts("")} style={[styles.chip, !categoryId && styles.chipActive]}>
                <Text style={!categoryId ? styles.chipActiveText : styles.chipText}>All</Text>
              </Pressable>
              {categories.map((category) => (
                <Pressable accessibilityRole="button" key={category.id} onPress={() => void filterProducts(category.id)} style={[styles.chip, categoryId === category.id && styles.chipActive]}>
                  <Text style={categoryId === category.id ? styles.chipActiveText : styles.chipText}>{category.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <Text style={[typography.title3, { marginBottom: spacing.md }]}>{categoryId ? "Products" : "Popular Products"}</Text>

          {loadingCatalog ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} /> : products.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={typography.title3}>No products found</Text>
              <Text style={typography.body}>Try adjusting your search or category.</Text>
            </View>
          ) : (
            <View style={styles.productGrid}>
              {products.map((item) => {
                const sellable = (item.variants ?? []).filter(variant => variant.isActive).sort((a, b) => Number(a.price) - Number(b.price));
                const purchasableVariants = sellable.filter((variant) => canPurchaseVariant(item, variant));
                const displayedPrice = sellable[0]?.price ?? item.price;
                return <Pressable accessibilityRole="button" key={item.id} onPress={() => void showProduct(item)} style={styles.productCard}>
                  {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.productThumb} /> : <PlaceholderImage name={item.name} style={styles.productThumb} />}
                  <View style={styles.productInfo}>
                    <Text style={typography.bodySemibold} numberOfLines={2}>{item.name}</Text>
                    <Text style={typography.caption} numberOfLines={1}>{item.categoryName ?? categories.find(c => c.id === item.categoryId)?.name ?? "Groceries"}</Text>
                    <Text style={[typography.title3, { color: colors.ink }]}>{sellable.length > 1 ? "From " : ""}₹{displayedPrice}</Text>
                    {!item.purchasable && <Text style={[typography.caption, { color: colors.danger }]}>{productAvailabilityLabel(item)}</Text>}
                  </View>
                  {purchasableVariants.length === 1 && (
                    <Pressable accessibilityRole="button" onPress={(e: any) => { e?.stopPropagation?.(); const onlyVariant = purchasableVariants[0]; if (onlyVariant) void addToCart(item, onlyVariant, 1); }} style={styles.addMiniBtn}>
                      <Text style={styles.addMiniBtnText}>+ Add</Text>
                    </Pressable>
                  )}
                </Pressable>
              })}
            </View>
          )}
          <PaginationControls pagination={storePagination} onPageChange={setStorePage} />
          {!!error && <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.md }]}>{error}</Text>}
        </View>
      </ScrollView>
    );
  } else {
    const activeAddress = addresses.find((a) => a.pincode === pincode) || addresses[0];

    content = (
      <ScrollView key="store-discovery" contentContainerStyle={commonStyles.page}>
        <View style={commonStyles.container}>
          <View style={styles.header}>
            <Text style={styles.greeting}>Hello,</Text>
            <Text style={typography.title1}>{customerName || "Welcome back"}</Text>
            <Text style={[typography.caption, { marginTop: spacing.sm }]}>⌖  Delivering to</Text>
            <Pressable accessibilityRole="button" onPress={openAddresses} style={styles.locationRow}>
              {loadingAddresses ? <Skeleton style={{ width: 150, height: 24, borderRadius: 6 }} /> : (
                <>
                  <Text style={typography.title2} numberOfLines={1}>{activeAddress ? `${activeAddress.label || activeAddress.city} • ${activeAddress.pincode}` : 'Add Delivery Address'}</Text>
                  <Text style={{ color: colors.accent, fontSize: 12 }}>▼</Text>
                </>
              )}
            </Pressable>
          </View>

          {productSearchField("Search products across nearby stores...")}
          <View style={[styles.searchBar, { marginTop: spacing.sm, marginBottom: spacing.xl }]}>
            <SearchIcon />
            <TextInput style={styles.searchInput} placeholder="Search supermarkets..." placeholderTextColor={colors.muted} value={storeSearchQuery} onChangeText={setStoreSearchQuery} />
          </View>

          <View style={styles.promo}>
            <Text style={styles.promoTitle}>Fresh Groceries{"\n"}Delivered to Your Door</Text>
            <Text style={styles.promoText}>Quality products from your local stores.</Text>
            <View style={styles.promoPill}><Text style={styles.promoPillText}>Shop now  ›</Text></View>
          </View>
          {homeCategories.length > 0 && <View style={{ marginBottom: spacing.xl }}>
            <Text style={[typography.title3, { marginBottom: spacing.md }]}>Shop by Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
              {homeCategories.map(category => <Pressable accessibilityRole="button" key={category.id} onPress={() => { selectStore(stores[0]); pendingCategoryId.current = category.id; }} style={styles.homeCategory}>
                <View style={styles.homeCategoryIcon}><Text style={styles.homeCategoryInitial}>{category.name.charAt(0).toUpperCase()}</Text></View>
                <Text style={styles.homeCategoryText} numberOfLines={1}>{category.name}</Text>
              </Pressable>)}
            </ScrollView>
          </View>}
          <Text style={[typography.title3, { marginBottom: spacing.md }]}>Supermarkets Near You</Text>
          
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
              <Text style={typography.body}>{storeSearchQuery ? "Try a different supermarket name." : "We don't serve this area yet. Try another address."}</Text>
              {!storeSearchQuery && <Pressable onPress={openAddresses} style={styles.secondaryBtn}><Text style={styles.secondaryBtnText}>Change Location</Text></Pressable>}
            </View>
          ) : (
            <View style={{ gap: spacing.lg }}>
              {filteredStores.map((item) => (
                <Pressable accessibilityRole="button" key={item.id} onPress={() => selectStore(item)} style={styles.storeCard}>
                  <View style={styles.storeCardInner}>
                    {item.logoImageUrl ? <Image source={{ uri: item.logoImageUrl }} style={styles.storeLogo} /> : <PlaceholderImage name={item.name} style={styles.storeLogo} />}
                    <View style={styles.storeInfo}>
                      <Text style={typography.title3} numberOfLines={1}>{item.name}</Text>
                       <Text style={typography.caption}>Delivery ₹{item.deliveryFee} · Min ₹{item.minimumOrderValue}</Text>
                       <Text style={typography.caption}>Serves {pincode}</Text>
                       <Text style={styles.shopNowText}>{item.operatingStatus === "OPEN" ? "Open now" : "Closed"}  ·  View store ›</Text>
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
      <View style={{ flex: 1 }}>
        {content}
        {!!addedNotice && <View accessibilityRole="alert" style={styles.addedToast}><Text style={styles.addedToastText}>✓  {addedNotice}</Text></View>}
        {cartUnits > 0 && <Pressable accessibilityRole="button" accessibilityLabel={`Go to cart, ${cartUnits} items`} onPress={openCart} style={styles.stickyCart}>
          <Text style={styles.stickyCartTitle}>Go to Cart</Text>
          <Text style={styles.stickyCartCount}>{cartUnits} {cartUnits === 1 ? "Item" : "Items"}  →</Text>
        </Pressable>}
      </View>
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
  pagination: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, marginVertical: spacing.lg },
  pageButton: { backgroundColor: colors.soft, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  pageButtonText: { ...typography.caption, color: colors.accent, fontWeight: "700" },
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
  primaryBtn: { backgroundColor: colors.accent, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md, width: "100%", alignItems: "center" },
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
  addMiniBtn: { position: "absolute", bottom: spacing.sm, left: spacing.sm, right: spacing.sm, height: 30, borderRadius: 7, backgroundColor: colors.accent, justifyContent: "center", alignItems: "center", zIndex: 2 },
  addMiniBtnText: { color: colors.card, fontSize: 12, fontWeight: "700" },
  productHero: { position: "relative", marginBottom: spacing.lg },
  heroImage: { width: "100%", height: 300, borderRadius: radius.xl },
  badge: { position: "absolute", top: spacing.md, left: spacing.md, backgroundColor: colors.card, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, ...shadows.sm },
  closed: { backgroundColor: colors.highlight },
  badgeText: { ...typography.caption, color: colors.ink, fontWeight: "800" },
  closedText: { color: colors.danger },
  qtyRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, marginBottom: spacing.xl },
  variantSection: { marginTop: spacing.md, marginBottom: spacing.lg, backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line },
  variantOption: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  variantOptionSelected: { borderColor: colors.accent, backgroundColor: colors.soft },
  variantUnavailable: { opacity: 0.55 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.muted, alignItems: "center", justifyContent: "center" },
  radioSelected: { borderColor: colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  stickyCart: { position: "absolute", left: spacing.lg, right: spacing.lg, bottom: 12, minHeight: 54, paddingHorizontal: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.accent, flexDirection: "row", alignItems: "center", justifyContent: "space-between", ...shadows.md },
  stickyCartTitle: { color: colors.card, fontSize: 16, fontWeight: "800" },
  stickyCartCount: { color: colors.card, fontSize: 14, fontWeight: "700" },
  addedToast: { position: "absolute", bottom: 78, left: spacing.lg, right: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.ink, alignItems: "center", ...shadows.sm },
  addedToastText: { color: colors.card, fontWeight: "700", fontSize: 13 },
  disabled: { opacity: 0.5 },
  greeting: { fontSize: 13, color: colors.muted },
  promo: { backgroundColor: colors.accent, borderRadius: radius.lg, padding: 18, minHeight: 132, marginBottom: spacing.xl, justifyContent: "center", overflow: "hidden" },
  promoTitle: { color: colors.card, fontSize: 19, fontWeight: "800", lineHeight: 24 },
  promoText: { color: "#E4EDFF", fontSize: 11, marginTop: 6 },
  promoPill: { backgroundColor: colors.card, borderRadius: 20, alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 6, marginTop: 12 },
  promoPillText: { color: colors.accent, fontSize: 11, fontWeight: "800" },
  storeHero: { height: 150, marginTop: -16, marginHorizontal: -spacing.lg, backgroundColor: colors.accent, position: "relative", justifyContent: "flex-end" },
  storeHeroImage: { width: "100%", height: "100%", position: "absolute" },
  heroBack: { position: "absolute", top: 10, left: 15, width: 32, height: 32, borderRadius: 16, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  heroBackText: { fontSize: 27, color: colors.ink, lineHeight: 31 },
  heroName: { color: colors.card, fontWeight: "800", fontSize: 24, textAlign: "center", padding: 12, backgroundColor: "#10275688" },
  storeHeading: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 18 },
  storeAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  storeAvatarText: { color: colors.card, fontSize: 22, fontWeight: "800" },
  openText: { color: colors.accent, fontSize: 12, marginTop: 3, fontWeight: "600" },
  categoryHeader: { flexDirection: "row", alignItems: "center", gap: 14, padding: 12, backgroundColor: colors.accent, marginHorizontal: -spacing.lg },
  categoryHeaderText: { color: colors.card, fontSize: 27 },
  categoryHeaderTitle: { color: colors.card, fontSize: 20, fontWeight: "800" },
  homeCategory: { width: 72, alignItems: "center", gap: 6 },
  homeCategoryIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center" },
  homeCategoryInitial: { color: colors.accent, fontSize: 22, fontWeight: "800" },
  homeCategoryText: { fontSize: 11, color: colors.ink, textAlign: "center" },
});