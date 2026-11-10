import { SupabaseStorageError } from "./supabase-storage.js";

export async function readWithNotFoundFallback<T>(
  readPrimary: () => Promise<T>,
  readLegacy: () => Promise<T>,
): Promise<T> {
  try {
    return await readPrimary();
  } catch (error) {
    if (!(error instanceof SupabaseStorageError) || error.code !== "NOT_FOUND") {
      throw error;
    }
    return readLegacy();
  }
}

export async function discardFromOwningStore(
  primaryHas: () => Promise<boolean>,
  discardPrimary: () => Promise<void>,
  discardLegacy: () => Promise<void>,
): Promise<void> {
  if (await primaryHas()) {
    await discardPrimary();
    return;
  }
  await discardLegacy();
}

export async function writeToSelectedStore<T>(
  usePrimary: boolean,
  writePrimary: () => Promise<T>,
  writeLegacy: () => Promise<T>,
): Promise<T> {
  return usePrimary ? writePrimary() : writeLegacy();
}
