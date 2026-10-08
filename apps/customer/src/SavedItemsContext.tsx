import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getCustomerSavedItems, removeCustomerSavedItem, saveCustomerItem, type CustomerSavedItem } from "@workspace/api-client-react";
import type { CustomerProduct } from "./lib/api";

export type SavedItem = CustomerSavedItem;

interface SavedItemsContextValue {
  items: SavedItem[];
  loading: boolean;
  error: string;
  isSaved: (productId: string) => boolean;
  load: (pincode?: string) => Promise<void>;
  toggle: (product: CustomerProduct, pincode?: string) => Promise<void>;
  remove: (productId: string, pincode?: string) => Promise<void>;
}

const SavedItemsContext = createContext<SavedItemsContextValue | null>(null);

export function SavedItemsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const itemsRef = useRef<SavedItem[]>([]);
  const requestRevision = useRef(0);
  const mutationRevision = useRef(0);
  const currentPincode = useRef<string | undefined>(undefined);
  itemsRef.current = items;

  const load = useCallback(async (pincode?: string) => {
    currentPincode.current = pincode;
    const revision = ++requestRevision.current;
    const expectedMutationRevision = mutationRevision.current;
    setLoading(true);
    setError("");
    try {
      const result = await getCustomerSavedItems(pincode ? { pincode } : undefined);
      if (revision !== requestRevision.current || expectedMutationRevision !== mutationRevision.current) return;
      itemsRef.current = result.items ?? [];
      setItems(itemsRef.current);
    } catch (cause) {
      if (revision === requestRevision.current && expectedMutationRevision === mutationRevision.current) {
        setError(cause instanceof Error ? cause.message : "Unable to load saved items.");
      }
    } finally {
      if (revision === requestRevision.current && expectedMutationRevision === mutationRevision.current) setLoading(false);
    }
  }, []);

  const remove = useCallback(async (productId: string, pincode?: string) => {
    setError("");
    try {
      await removeCustomerSavedItem(productId);
      mutationRevision.current += 1;
      const next = itemsRef.current.filter(item => item.productId !== productId);
      itemsRef.current = next;
      setItems(next);
      await load(pincode ?? currentPincode.current);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to remove saved item.";
      setError(message);
      throw new Error(message);
    }
  }, [load]);

  const toggle = useCallback(async (product: CustomerProduct, pincode?: string) => {
    if (!pincode) {
      const message = "Choose a delivery address before saving an item.";
      setError(message);
      throw new Error(message);
    }
    if (itemsRef.current.some(item => item.productId === product.id)) {
      await remove(product.id, pincode);
      return;
    }
    setError("");
    try {
      await saveCustomerItem({ productId: product.id, pincode });
      mutationRevision.current += 1;
      await load(currentPincode.current);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to save this item.";
      setError(message);
      throw new Error(message);
    }
  }, [load, remove]);

  const value = useMemo(() => ({
    items, loading, error,
    isSaved: (productId: string) => items.some(item => item.productId === productId),
    load, toggle, remove,
  }), [items, loading, error, load, toggle, remove]);

  return <SavedItemsContext.Provider value={value}>{children}</SavedItemsContext.Provider>;
}

export function useSavedItems() {
  const context = useContext(SavedItemsContext);
  if (!context) throw new Error("useSavedItems must be used within SavedItemsProvider.");
  return context;
}
