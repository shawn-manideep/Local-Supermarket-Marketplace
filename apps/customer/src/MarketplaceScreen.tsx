import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { formatVariantName } from "@workspace/validation/variant-formatting";
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, View, Animated } from "react-native";
import { CustomerText as Text, CustomerTextInput as TextInput } from "./components/CustomerTypography";
import { customerApi, type CustomerAddress, type CustomerCategory, type CustomerProduct, type CustomerProductPagination, type CustomerProductSearchResponse, type CustomerProductVariant, type CustomerStore, type CustomerProfile } from "./lib/api";
import { colors, fontWeights, radius, spacing, typography, commonStyles, shadows } from "./theme";
import { PlaceholderImage } from "./components/PlaceholderImage";
import { ConfirmationDialog } from "./components/ConfirmationDialog";
import { ShoppingProductCard } from "./components/ShoppingProductCard";
import { ShoppingProductDetails } from "./components/ShoppingProductDetails";
import type { CustomerShoppingCategory } from "./lib/api";
import { canPurchaseVariant, cartItemInput, discoveryQuery, freshCartSelection, initialVariantId, retainedVariantId, shoppingError, matchingCustomerStores } from "./lib/shopping";
import { HomeHistory } from "./HomeHistory";
import { FavoriteControl } from "./components/FavoriteControl";
import { useSavedItems } from "./SavedItemsContext";

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
  return formatVariantName(variant.quantityValue, variant.quantityUnit);
}
function customerStoreLocation(store: CustomerStore) {
  return [store.locality, store.city, store.state, store.pincode].filter(Boolean).join(", ");
}

export function MarketplaceScreen({ openAddresses, openCart, resetToken, onCartUnitsChange, active = true, requestedStoreId, onStoreRequestHandled, onOpenOrder, onPincodeChange, requestedSavedItem, onSavedItemRequestHandled }: { openAddresses: () => void; openCart: () => void; resetToken: number; onCartUnitsChange?: (count: number) => void; active?: boolean; requestedStoreId?: string; onStoreRequestHandled?: () => void; onOpenOrder?: (orderId: string) => void; onPincodeChange?: (pincode: string) => void; requestedSavedItem?: { productId: string; storeId: string }; onSavedItemRequestHandled?: () => void }) {
  const savedItems = useSavedItems();
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [pincode, setPincode] = useState("");
  const [stores, setStores] = useState<CustomerStore[]>([]);
  const [storeDirectoryPincode, setStoreDirectoryPincode] = useState("");
  const [homeCategories, setHomeCategories] = useState<CustomerShoppingCategory[]>([]);
  const [globalCategoryId, setGlobalCategoryId] = useState("");
  const [searchRetry, setSearchRetry] = useState(0);
  const [categoryRetry, setCategoryRetry] = useState(0);
  const [categoryError, setCategoryError] = useState(false);
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
  const [shoppingIntentNotice, setShoppingIntentNotice] = useState("");
  
  const [searchQuery, setSearchQuery] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [adding, setAdding] = useState(false);
  const [addedNotice, setAddedNotice] = useState("");
  const [cartUnits, setCartUnits] = useState(0);
  const [cartStoreName, setCartStoreName] = useState("");
  const [cartSummaryError, setCartSummaryError] = useState(false);

  const [switchDialogVisible, setSwitchDialogVisible] = useState(false);
  const [switchDialogLoading, setSwitchDialogLoading] = useState(false);
  const [pendingProduct, setPendingProduct] = useState<{product: CustomerProduct, variant: CustomerProductVariant, qty: number} | null>(null);

  const discoveryGeneration = useRef(0);
  const catalogGeneration = useRef(0);
  const storeCatalogGeneration = useRef(0);
  const globalSearchGeneration = useRef(0);
  const pendingCategoryId = useRef("");
  const cartAddInFlight = useRef(false);
  const productRefreshGeneration = useRef(0);
  const defaultAddressId = useRef("");
  const selectedAddressIdRef = useRef("");

  const matchingStores = useMemo(() => matchingCustomerStores(stores, searchQuery), [stores, searchQuery]);
  const filteredStores = stores;
  const currentStoreId = store?.id;

  const clearCatalog = () => {
    ++catalogGeneration.current;
    ++storeCatalogGeneration.current;
    ++globalSearchGeneration.current;
    setCategories([]); setProducts([]); setStorePagination(null); setProduct(null); setCategoryId(""); setSearchQuery("");
    setGlobalProducts([]); setGlobalPagination(null); setGlobalPage(1); setStorePage(1);
    setGlobalCategoryId(""); setSelectedVariantId(""); setLoadingCatalog(false);
  };

  const selectStore = (nextStore: CustomerStore | null) => {
    pendingCategoryId.current = "";
    setShoppingIntentNotice("");
    clearCatalog();
    setError("");
    if (!nextStore) setLoadingCatalog(false);
    setStore(nextStore);
  };

  useEffect(() => {
    if (resetToken > 0) { setShoppingIntentNotice(""); selectStore(null); }
  }, [resetToken]);

  const loadAddresses = useCallback(() => {
    setLoadingAddresses(true); setError("");
    const controller = new AbortController();
    customerApi<{ addresses: CustomerAddress[] }>("/api/customer/addresses", { signal: controller.signal })
      .then(({ addresses: next }) => {
        if (controller.signal.aborted) return;
        setAddresses(next);
        const nextDefaultId = next.find((address) => address.isDefault)?.id ?? next[0]?.id ?? "";
        const priorSelectionStillExists = next.some(address => address.id === selectedAddressIdRef.current);
        const defaultChanged = !!defaultAddressId.current && defaultAddressId.current !== nextDefaultId;
        const selected = defaultChanged || !priorSelectionStillExists
          ? next.find(address => address.id === nextDefaultId) ?? next[0]
          : next.find(address => address.id === selectedAddressIdRef.current) ?? next.find(address => address.id === nextDefaultId) ?? next[0];
        defaultAddressId.current = nextDefaultId;
        selectedAddressIdRef.current = selected?.id ?? "";
        setSelectedAddressId(selected?.id ?? "");
        setPincode(selected?.pincode ?? "");
        onPincodeChange?.(selected?.pincode ?? "");
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(shoppingError(reason, "Unable to load delivery addresses. Please try again.")); })
      .finally(() => { if (!controller.signal.aborted) setLoadingAddresses(false); });
    return () => controller.abort();
  }, [onPincodeChange]);

  useEffect(() => active ? loadAddresses() : undefined, [loadAddresses, active]);
  useEffect(() => {
    if (active) void savedItems.load(pincode || undefined);
  }, [active, pincode]);
  const refreshCart = useCallback(async () => {
    try {
      const result = await customerApi<{ cart: { storeName: string; items: Array<{ quantity: number }> } | null }>("/api/customer/cart");
      const count = result.cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
      setCartUnits(count);
      setCartStoreName(result.cart?.storeName ?? "");
      setCartSummaryError(false);
      onCartUnitsChange?.(count);
    } catch { setCartSummaryError(true); }
  }, [onCartUnitsChange]);
  useEffect(() => { if (active) void refreshCart(); }, [refreshCart, active]);
  useEffect(() => {
    let active = true;
    customerApi<{ profile: CustomerProfile }>("/api/customer/profile")
      .then(({ profile }) => { if (active) setCustomerName(profile.fullName?.split(" ")[0] ?? ""); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const loadStores = useCallback(() => {
    const generation = ++discoveryGeneration.current;
    if (!pincode) { setStores([]); setStoreDirectoryPincode(""); setStore(null); clearCatalog(); setLoadingStores(false); return; }
    setLoadingStores(true); setError(""); setStores([]); setStoreDirectoryPincode(""); setStore(null); clearCatalog();
    customerApi<{ stores: CustomerStore[] }>(`/api/customer/stores?pincode=${pincode}`)
      .then(({ stores: next }) => { if (generation === discoveryGeneration.current) { setStores(next); setStoreDirectoryPincode(pincode); } })
      .catch((reason) => { if (generation === discoveryGeneration.current) setError(shoppingError(reason, "Unable to find supermarkets. Please try again.")); })
      .finally(() => { if (generation === discoveryGeneration.current) setLoadingStores(false); });
  }, [pincode]);

  useEffect(() => { loadStores(); }, [loadStores]);
  useEffect(() => {
    if (!active || !requestedStoreId || !pincode || loadingAddresses || loadingStores || storeDirectoryPincode !== pincode) return;
    const eligibleStore = stores.find(candidate => candidate.id === requestedStoreId);
    if (eligibleStore) {
      setShoppingIntentNotice("");
      if (store?.id !== eligibleStore.id) selectStore(eligibleStore);
    } else {
      setShoppingIntentNotice("Your basket’s supermarket is not available for this delivery location. Your basket has not been changed.");
    }
    onStoreRequestHandled?.();
  }, [active, requestedStoreId, pincode, loadingAddresses, loadingStores, storeDirectoryPincode, stores]);
  useEffect(() => {
    if (!active || !requestedSavedItem || !pincode || loadingAddresses || loadingStores || storeDirectoryPincode !== pincode) return;
    const target = requestedSavedItem;
    const targetStore = stores.find(candidate => candidate.id === target.storeId);
    if (!targetStore) {
      setShoppingIntentNotice("This saved product’s store is not available for your selected delivery location.");
      onSavedItemRequestHandled?.();
      return;
    }
    const generation = ++catalogGeneration.current;
    setLoadingCatalog(true);
    setError("");
    void Promise.all([
      customerApi<{ categories: CustomerCategory[] }>(`/api/customer/stores/${target.storeId}/categories?pincode=${pincode}`),
      customerApi<{ product: CustomerProduct }>(`/api/customer/stores/${target.storeId}/products/${target.productId}?pincode=${pincode}`),
    ]).then(([categoryResult, productResult]) => {
      if (generation !== catalogGeneration.current) return;
      setStore(targetStore);
      setCategories(categoryResult.categories);
      setCategoryId(productResult.product.categoryId ?? "");
      setStorePage(1);
      setProducts([]);
      setStorePagination(null);
      setProduct(productResult.product);
      setSelectedVariantId(initialVariantId(productResult.product));
      setQuantity(1);
      setShoppingIntentNotice("");
    }).catch(reason => {
      if (generation === catalogGeneration.current) setError(shoppingError(reason, "Unable to open this saved product. Please try again."));
    }).finally(() => {
      if (generation === catalogGeneration.current) setLoadingCatalog(false);
      onSavedItemRequestHandled?.();
    });
  }, [active, requestedSavedItem, pincode, loadingAddresses, loadingStores, storeDirectoryPincode, stores]);
  useEffect(() => {
    if (!pincode) { setHomeCategories([]); return; }
    let active = true;
    setCategoryError(false);
    setHomeCategories([]);
    customerApi<{ categories: CustomerShoppingCategory[] }>(`/api/customer/categories?pincode=${pincode}`)
      .then(result => { if (active) setHomeCategories(result.categories); })
      .catch(() => { if (active) setCategoryError(true); });
    return () => { active = false; };
  }, [pincode, categoryRetry]);

  useEffect(() => {
    if (!store) return;
    const generation = ++storeCatalogGeneration.current;
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
      if (generation === storeCatalogGeneration.current) {
        setCategories(categoryResult.categories);
        setProducts(productResult.products);
        setStorePagination(productResult.pagination);
         pendingCategoryId.current = "";
      }
    }).catch((reason) => {
      if (generation === storeCatalogGeneration.current) setError(shoppingError(reason, "Unable to load this store's products. Please try again."));
    }).finally(() => { if (generation === storeCatalogGeneration.current) setLoadingCatalog(false); });
    return () => { if (generation === storeCatalogGeneration.current) ++storeCatalogGeneration.current; };
  }, [store, pincode, categoryId, storePage]);

  useEffect(() => {
    const search = searchQuery.trim();
    if (!pincode || (!search && !globalCategoryId)) {
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
      const query = discoveryQuery(pincode, search, globalCategoryId, globalPage);
      customerApi<CustomerProductSearchResponse>(`/api/customer/products?${query}`)
        .then((result) => {
          if (generation === globalSearchGeneration.current) {
            setGlobalProducts(result.products);
            setGlobalPagination(result.pagination);
          }
        })
        .catch((reason) => {
          if (generation === globalSearchGeneration.current) setError(shoppingError(reason, "Unable to search products. Please try again."));
        })
        .finally(() => {
          if (generation === globalSearchGeneration.current) setLoadingGlobalProducts(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      if (generation === globalSearchGeneration.current) ++globalSearchGeneration.current;
    };
  }, [pincode, searchQuery, globalPage, globalCategoryId, searchRetry]);

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
        setSelectedVariantId(initialVariantId(productResult.product));
        setQuantity(1);
      }
    } catch (reason) {
      if (generation === catalogGeneration.current) setError(shoppingError(reason, "Unable to open this product. Please try again."));
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
        setSelectedVariantId(initialVariantId(result.product));
      }
    } catch (reason) { if (generation === catalogGeneration.current) setError(shoppingError(reason, "Unable to load this product. Please try again.")); }
    finally { if (generation === catalogGeneration.current) setLoadingCatalog(false); }
  };

  useEffect(() => {
    if (!active || !product || !store || !pincode) return;
    let cancelled = false;
    const timer = setInterval(() => {
      if (cartAddInFlight.current) return;
      const generation = ++productRefreshGeneration.current;
      customerApi<{ product: CustomerProduct }>(`/api/customer/stores/${store.id}/products/${product.id}?pincode=${pincode}`)
        .then(result => {
          if (cancelled || generation !== productRefreshGeneration.current) return;
          setProduct(result.product);
          setSelectedVariantId(current => retainedVariantId(result.product, current));
        })
        .catch(reason => {
          if (!cancelled && generation === productRefreshGeneration.current) setError(shoppingError(reason, "Couldn't refresh availability. Please reopen this product."));
        });
    }, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [active, product?.id, store?.id, pincode]);

  const currentCartSelection = (listing: CustomerProduct, variantId: string, generation: number) => {
    ++productRefreshGeneration.current;
    return freshCartSelection(listing, variantId, async () => {
      const result = await customerApi<{ product: CustomerProduct }>(`/api/customer/stores/${listing.storeId}/products/${listing.id}?pincode=${pincode}`);
      if (generation === catalogGeneration.current && product?.id === listing.id && product.storeId === listing.storeId
        && result.product.id === listing.id && result.product.storeId === listing.storeId) {
        setProduct(result.product);
        setSelectedVariantId(current => retainedVariantId(result.product, current));
      }
      return result.product;
    });
  };

  const addToCart = async (selected: CustomerProduct, variant: CustomerProductVariant, qty: number, confirmStoreSwitch = false) => {
    if (!canPurchaseVariant(selected, variant)) {
      setError("This option is currently unavailable.");
      return;
    }
    if (cartAddInFlight.current) return;
    cartAddInFlight.current = true;
    const generation = catalogGeneration.current;
    setAdding(true);
    setError("");
    try {
      const fresh = await currentCartSelection(selected, variant.id, generation);
      if (generation !== catalogGeneration.current) return;
      const result = await customerApi<{ cart: { items: Array<{ quantity: number }>; storeName?: string } | null }>("/api/customer/cart/items", { method:"POST", body:JSON.stringify(cartItemInput(fresh.product, fresh.variant, qty, confirmStoreSwitch)) });
      const count = result.cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
      setCartUnits(count); onCartUnitsChange?.(count);
      setCartStoreName(result.cart?.storeName ?? selected.storeName ?? store?.name ?? "");
      setCartSummaryError(false);
      setAddedNotice(`${selected.name} · ${customerVariantLabel(variant)} added to cart`);
      setTimeout(() => setAddedNotice(""), 2600);
    } catch (reason) {
      if (generation !== catalogGeneration.current) return;
      const errorMsg = reason instanceof Error ? reason.message : "Unable to add product.";
      if (errorMsg === "Store switch required") {
        setPendingProduct({ product: selected, variant, qty });
        setSwitchDialogVisible(true);
      } else {
        setError(shoppingError(reason, "Unable to add this item. Please try again."));
      }
    } finally { 
      cartAddInFlight.current = false;
      setAdding(false); 
    }
  };

  const confirmSwitchCart = async () => {
    if (!pendingProduct || cartAddInFlight.current) return;
    cartAddInFlight.current = true;
    const generation = catalogGeneration.current;
    setSwitchDialogLoading(true);
    setError("");
    try {
      const fresh = await currentCartSelection(pendingProduct.product, pendingProduct.variant.id, generation);
      if (generation !== catalogGeneration.current) {
        setSwitchDialogVisible(false); setPendingProduct(null);
        return;
      }
      const result = await customerApi<{ cart: { items: Array<{ quantity: number }>; storeName?: string } | null }>("/api/customer/cart/items", { method:"POST", body:JSON.stringify(cartItemInput(fresh.product, fresh.variant, pendingProduct.qty, true)) });
      const count = result.cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
      setCartUnits(count); onCartUnitsChange?.(count);
      setCartStoreName(result.cart?.storeName ?? pendingProduct.product.storeName ?? store?.name ?? "");
      setCartSummaryError(false);
      setSwitchDialogVisible(false);
      setAddedNotice(`${pendingProduct.product.name} · ${customerVariantLabel(pendingProduct.variant)} added to cart`);
      setTimeout(() => setAddedNotice(""), 2600);
      setPendingProduct(null);
    } catch (reason) {
      setError(shoppingError(reason, "Unable to start a basket at this store. Please try again."));
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
        accessibilityLabel="Search products or stores"
        style={styles.searchInput}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        value={searchQuery}
        maxLength={120}
        onChangeText={(value) => { setSearchQuery(value); setGlobalPage(1); setError(""); }}
      />
      {!!searchQuery && <Pressable accessibilityRole="button" accessibilityLabel="Clear product search" onPress={() => { setSearchQuery(""); setGlobalPage(1); setError(""); }}><Text style={styles.backText}>Clear</Text></Pressable>}
    </View>
  );

  const clearSearch = () => {
    ++catalogGeneration.current;
    setSearchQuery(""); setGlobalCategoryId(""); setGlobalPage(1); setError("");
    setLoadingCatalog(false);
  };
  const closeProduct = () => {
    ++catalogGeneration.current;
    setProduct(null); setSelectedVariantId(""); setQuantity(1); setError("");
    setLoadingCatalog(false);
  };
  const categoryFilters = () => (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.md }}>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: !globalCategoryId }} style={[styles.chip, !globalCategoryId && styles.chipActive]} onPress={() => { setGlobalCategoryId(""); setGlobalPage(1); setError(""); }}>
          <Text style={!globalCategoryId ? styles.chipActiveText : styles.chipText}>All categories</Text>
        </Pressable>
        {homeCategories.map(category => <Pressable accessibilityRole="button" accessibilityState={{ selected: globalCategoryId === category.id }} key={category.id} style={[styles.chip, globalCategoryId === category.id && styles.chipActive]} onPress={() => { setGlobalCategoryId(category.id); setGlobalPage(1); setError(""); }}>
          <Text style={globalCategoryId === category.id ? styles.chipActiveText : styles.chipText}>{category.name}</Text>
        </Pressable>)}
      </ScrollView>
      {categoryError && <Pressable accessibilityRole="button" onPress={() => setCategoryRetry(value => value + 1)}><Text style={typography.caption}>Category filters couldn't load. You can still search. Tap to retry.</Text></Pressable>}
    </View>
  );

  let content;

  if (!product && (searchQuery.trim() || globalCategoryId) && pincode) {
    content = (
      <ScrollView key="global-product-search" style={commonStyles.viewport} contentContainerStyle={commonStyles.page}>
        <View style={commonStyles.container}>
          <View style={styles.storeHeading}>
            <View style={styles.storeAvatar}><Text style={styles.storeAvatarText}>⌕</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={typography.title2}>Search all nearby stores</Text>
              <Text style={typography.caption}>Available listings serving {pincode}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={clearSearch}><Text style={styles.backText}>Back to shopping</Text></Pressable>
          </View>
          {productSearchField("Search products or stores")}
          {categoryFilters()}
          {!!searchQuery.trim() && <View style={{ marginTop: spacing.lg, gap: spacing.md }}>
            <Text style={typography.title3}>Matching stores</Text>
            {loadingStores || storeDirectoryPincode !== pincode ? <ActivityIndicator accessibilityLabel="Loading stores" color={colors.accent} /> :
              matchingStores.length === 0 ? <Text style={typography.caption}>No matching stores in your delivery area.</Text> :
                matchingStores.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Open ${item.name}`} style={styles.storeCard} onPress={() => { clearSearch(); selectStore(item); }}>
                  <Text style={typography.title3}>{item.name}</Text>
                  <Text style={typography.caption}>{customerStoreLocation(item) || "Serving your selected delivery area"}</Text>
                  <Text style={[typography.caption, { color: colors.accent }]}>Browse store</Text>
                </Pressable>)}
          </View>}
          <Text style={[typography.title3, { marginTop: spacing.lg }]}>Products</Text>
          {loadingCatalog && <Text accessibilityLiveRegion="polite" style={typography.caption}>Opening product…</Text>}
          {error ? <View style={styles.emptyState}><Text accessibilityRole="alert" style={typography.body}>{error}</Text><Pressable accessibilityRole="button" onPress={() => { setError(""); setSearchRetry(value => value + 1); }} style={styles.primaryBtn}><Text style={styles.primaryBtnText}>Try again</Text></Pressable></View> : loadingGlobalProducts ? <ActivityIndicator accessibilityLabel="Searching products" color={colors.accent} style={{ marginTop: spacing.xl }} /> : globalProducts.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={typography.title3}>No products found</Text>
              <Text style={typography.body}>Try another search or browse a different category.</Text>
            </View>
          ) : (
            <>
              <Text style={[typography.title3, { marginVertical: spacing.md }]}>{globalPagination?.total ?? globalProducts.length} matching store offers</Text>
              <View style={styles.productGrid}>
                {globalProducts.map(item => <ShoppingProductCard key={`${item.storeId}:${item.id}`} product={item} pincode={pincode} busy={adding || switchDialogLoading} onOpen={() => void selectGlobalOffer(item)} onAdd={variant => void addToCart(item, variant, 1)} />)}
              </View>
              <PaginationControls pagination={globalPagination} onPageChange={setGlobalPage} />
            </>
          )}
        </View>
      </ScrollView>
    );
  } else if (product && store) {
    content = <ShoppingProductDetails key="product-detail" product={product} store={store} pincode={pincode}
      favoriteControl={<FavoriteControl product={product} pincode={pincode} />}
      selectedVariantId={selectedVariantId} quantity={quantity} busy={adding || switchDialogLoading}
      hasCart={cartUnits > 0} error={error}
      backLabel={searchQuery.trim() || globalCategoryId ? "Back to search results" : `Back to ${store.name}`}
      onBack={closeProduct}
      onSelect={variant => {
        if (!canPurchaseVariant(product, variant) || adding || switchDialogLoading) return;
        if (variant.id !== selectedVariantId) { setSelectedVariantId(variant.id); setQuantity(1); }
        setError("");
      }}
      onQuantityChange={setQuantity} onAdd={variant => void addToCart(product, variant, quantity)} />;
  } else if (store) {
    content = (
      <ScrollView key={`store-${store.id}-${categoryId}`} style={commonStyles.viewport} contentContainerStyle={commonStyles.page}>
        <View style={commonStyles.container}>
          <View style={styles.storeHero}>
            {store.logoImageUrl ? <Image source={{ uri: store.logoImageUrl }} style={styles.storeHeroImage} /> : <PlaceholderImage name={store.name} style={styles.storeHeroImage} />}
            <Pressable accessibilityLabel="Change supermarket" accessibilityRole="button" onPress={() => selectStore(null)} style={styles.heroBack}><Text style={styles.heroBackText}>‹</Text></Pressable>
            <Text style={styles.heroName}>{store.name}</Text>
          </View>
          <View style={styles.storeHeading}>
            <View style={styles.storeAvatar}><Text style={styles.storeAvatarText}>{store.name.charAt(0).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}><Text style={typography.title2}>{store.name}</Text><Text style={typography.caption}>{customerStoreLocation(store) || store.description || `Delivery ₹${store.deliveryFee} · Min ₹${store.minimumOrderValue}`}</Text><Text style={styles.openText}>{store.operatingStatus === "OPEN" ? "Open" : "Closed"} · Serves {pincode}</Text></View>
          </View>
          {productSearchField("Search products or stores")}

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

          {error ? <View style={styles.emptyState}><Text accessibilityRole="alert" style={typography.body}>{error}</Text><Pressable accessibilityRole="button" onPress={() => setStore({ ...store })} style={styles.primaryBtn}><Text style={styles.primaryBtnText}>Try again</Text></Pressable></View> : loadingCatalog ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} /> : products.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={typography.title3}>No products found</Text>
              <Text style={typography.body}>Try adjusting your search or category.</Text>
            </View>
          ) : (
            <View style={styles.productGrid}>
              {products.map(item => <ShoppingProductCard key={item.id} product={item} pincode={pincode} busy={adding || switchDialogLoading} onOpen={() => void showProduct(item)} onAdd={variant => void addToCart(item, variant, 1)} />)}
            </View>
          )}
          <PaginationControls pagination={storePagination} onPageChange={setStorePage} />
          {!!error && <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.md }]}>{error}</Text>}
        </View>
      </ScrollView>
    );
  } else {
    const activeAddress = addresses.find((a) => a.id === selectedAddressId) ?? addresses.find((a) => a.pincode === pincode) ?? addresses[0];

    content = (
      <ScrollView key="store-discovery" style={commonStyles.viewport} contentContainerStyle={commonStyles.page}>
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

          {productSearchField("Search products or stores")}
          {!!shoppingIntentNotice && <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger, marginTop: spacing.sm }]}>{shoppingIntentNotice}</Text>}
          {categoryError && <Pressable accessibilityRole="button" onPress={() => setCategoryRetry(value => value + 1)}><Text style={typography.caption}>Category filters couldn't load. Search still works. Tap to retry.</Text></Pressable>}

          <Text style={[typography.caption, { marginTop: spacing.md }]}>Browse eligible supermarkets and their current grocery options.</Text>
          {homeCategories.length > 0 && <View style={{ marginBottom: spacing.xl }}>
            <Text style={[typography.title3, { marginBottom: spacing.md }]}>Shop by Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
              {homeCategories.map(category => <Pressable accessibilityRole="button" key={category.id} onPress={() => { setGlobalCategoryId(category.id); setGlobalPage(1); setError(""); }} style={styles.homeCategory}>
                <View style={styles.homeCategoryIcon}><Text style={styles.homeCategoryInitial}>{category.name.charAt(0).toUpperCase()}</Text></View>
                <Text style={styles.homeCategoryText} numberOfLines={1}>{category.name}</Text>
              </Pressable>)}
            </ScrollView>
          </View>}
          <HomeHistory key={`home-history-${!active || loadingAddresses ? "inactive" : `${activeAddress?.id ?? "none"}-${pincode}`}`}
            active={active && !loadingAddresses} addressId={activeAddress?.id ?? ""} stores={stores}
            storesReady={!loadingStores && !loadingAddresses && storeDirectoryPincode === pincode}
            onOpenStore={(storeId) => {
              const eligibleStore = stores.find(candidate => candidate.id === storeId);
              if (eligibleStore && storeDirectoryPincode === pincode && !loadingStores && currentStoreId !== eligibleStore.id) selectStore(eligibleStore);
            }}
            onOpenOrder={(id) => onOpenOrder?.(id)} onCart={openCart} />
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
              <Text style={typography.body}>We don't serve this area yet. Try another address.</Text>
              <Pressable onPress={openAddresses} style={styles.secondaryBtn}><Text style={styles.secondaryBtnText}>Change Location</Text></Pressable>
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
                       {!!customerStoreLocation(item) && <Text style={typography.caption} numberOfLines={2}>{customerStoreLocation(item)}</Text>}
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
      <View style={[{ flex: 1 }, commonStyles.viewport]}>
        {content}
        {!!addedNotice && <View accessibilityRole="alert" style={styles.addedToast}><Text style={styles.addedToastText}>✓  {addedNotice}</Text></View>}
        {cartSummaryError && <Pressable accessibilityRole="button" accessibilityLabel="Retry basket summary" onPress={() => void refreshCart()} style={styles.cartError}>
          <Text style={styles.cartErrorText}>Basket details couldn’t load.</Text><Text style={styles.cartErrorLink}>Retry</Text>
        </Pressable>}
        {cartUnits > 0 && !cartSummaryError && <Pressable accessibilityRole="button" accessibilityLabel={`Go to cart, ${cartUnits} items${cartStoreName ? ` from ${cartStoreName}` : ""}`} disabled={adding || switchDialogLoading} onPress={openCart} style={styles.stickyCart}>
          <View style={{ flex: 1 }}><Text style={styles.stickyCartTitle}>Go to Cart</Text><Text style={styles.stickyStoreName} numberOfLines={1}>{cartStoreName || "Your supermarket basket"}</Text></View>
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
  statusBadgeText: { fontSize: 10, fontWeight: fontWeights.medium, color: colors.ink },
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
  addMiniBtnText: { color: colors.card, fontSize: 12, fontWeight: fontWeights.semibold },
  productHero: { position: "relative", marginBottom: spacing.lg },
  heroImage: { width: "100%", height: 300, borderRadius: radius.xl },
  badge: { position: "absolute", top: spacing.md, left: spacing.md, backgroundColor: colors.card, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, ...shadows.sm },
  closed: { backgroundColor: colors.highlight },
  badgeText: { ...typography.caption, color: colors.ink, fontWeight: fontWeights.medium },
  closedText: { color: colors.danger },
  qtyRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, marginBottom: spacing.xl },
  variantSection: { marginTop: spacing.md, marginBottom: spacing.lg, backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line },
  variantOption: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  variantOptionSelected: { borderColor: colors.accent, backgroundColor: colors.soft },
  variantUnavailable: { opacity: 0.55 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.muted, alignItems: "center", justifyContent: "center" },
  radioSelected: { borderColor: colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  stickyCart: { position: "absolute", left: spacing.lg, right: spacing.lg, bottom: 12, minHeight: 64, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.lg, backgroundColor: colors.accent, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, ...shadows.md },
  stickyCartTitle: { color: colors.card, fontSize: 16, fontWeight: fontWeights.semibold },
  stickyStoreName: { color: colors.card, fontSize: 11, opacity: 0.88 },
  stickyCartCount: { color: colors.card, fontSize: 14, fontWeight: fontWeights.semibold },
  cartError: { position: "absolute", left: spacing.lg, right: spacing.lg, bottom: 12, minHeight: 54, paddingHorizontal: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.highlight, flexDirection: "row", alignItems: "center", justifyContent: "space-between", ...shadows.md },
  cartErrorText: { color: colors.danger, fontSize: 13, fontWeight: "600" },
  cartErrorLink: { color: colors.ink, fontWeight: fontWeights.semibold },
  addedToast: { position: "absolute", bottom: 78, left: spacing.lg, right: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.ink, alignItems: "center", ...shadows.sm },
  addedToastText: { color: colors.card, fontWeight: fontWeights.semibold, fontSize: 13 },
  disabled: { opacity: 0.5 },
  greeting: { fontSize: 13, color: colors.muted },
  promo: { backgroundColor: colors.accent, borderRadius: radius.lg, padding: 18, minHeight: 132, marginBottom: spacing.xl, justifyContent: "center", overflow: "hidden" },
  promoTitle: { color: colors.card, fontSize: 19, fontWeight: fontWeights.semibold, lineHeight: 24 },
  promoText: { color: "rgba(255,255,255,0.84)", fontSize: 11, marginTop: 6 },
  promoPill: { backgroundColor: colors.card, borderRadius: 20, alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 6, marginTop: 12 },
  promoPillText: { color: colors.accent, fontSize: 11, fontWeight: fontWeights.semibold },
  storeHero: { height: 150, marginTop: -16, marginHorizontal: -spacing.lg, backgroundColor: colors.accent, position: "relative", justifyContent: "flex-end" },
  storeHeroImage: { width: "100%", height: "100%", position: "absolute" },
  heroBack: { position: "absolute", top: 10, left: 15, width: 32, height: 32, borderRadius: 16, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  heroBackText: { fontSize: 27, color: colors.ink, lineHeight: 31 },
  heroName: { color: colors.card, fontWeight: fontWeights.bold, fontSize: 24, textAlign: "center", padding: 12, backgroundColor: colors.navyOverlay },
  storeHeading: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 18 },
  storeAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  storeAvatarText: { color: colors.card, fontSize: 22, fontWeight: fontWeights.semibold },
  openText: { color: colors.accent, fontSize: 12, marginTop: 3, fontWeight: "600" },
  categoryHeader: { flexDirection: "row", alignItems: "center", gap: 14, padding: 12, backgroundColor: colors.accent, marginHorizontal: -spacing.lg },
  categoryHeaderText: { color: colors.card, fontSize: 27 },
  categoryHeaderTitle: { color: colors.card, fontSize: 20, fontWeight: fontWeights.semibold },
  homeCategory: { width: 72, alignItems: "center", gap: 6 },
  homeCategoryIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center" },
  homeCategoryInitial: { color: colors.accent, fontSize: 22, fontWeight: fontWeights.semibold },
  homeCategoryText: { fontSize: 11, color: colors.ink, textAlign: "center" },
});