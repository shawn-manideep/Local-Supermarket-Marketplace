import { sql } from "drizzle-orm";
import type { getDb } from "@workspace/db";
import { HttpError } from "../http.js";

type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
export type InventoryTransaction = Pick<Transaction, "execute">;
export interface InventoryLine {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  quantity: number;
}
export type StockCode = "OUT_OF_STOCK" | "INSUFFICIENT_STOCK" | "VARIANT_UNAVAILABLE" | "INVALID_QUANTITY";
export function stockError(code: StockCode, line: Pick<InventoryLine, "productName" | "variantName">) {
  const item = `${line.productName} (${line.variantName})`;
  const message = code === "OUT_OF_STOCK" ? `${item} is out of stock. Please review your cart.`
    : code === "INSUFFICIENT_STOCK" ? `${item} is no longer available in the selected quantity. Please reduce the quantity in your cart.`
    : code === "INVALID_QUANTITY" ? `${item}: choose a whole quantity between 1 and 999.`
    : `${item} is no longer available. Please review your cart.`;
  return new HttpError(code === "INVALID_QUANTITY" ? 400 : 409, message, undefined, code);
}

/** Call only inside the order transaction. Every write has a database-side guard. */
export async function deductStock(tx: InventoryTransaction, storeId: string, lines: InventoryLine[]) {
  const seen = new Set<string>();
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 999 || seen.has(line.variantId))
      throw stockError("INVALID_QUANTITY", line);
    seen.add(line.variantId);
  }
  for (const line of [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
    const updated = await tx.execute(sql`
      UPDATE product_variants v SET stock_quantity = v.stock_quantity - ${line.quantity}, updated_at = GREATEST(clock_timestamp(), v.updated_at + interval '1 millisecond')
      WHERE v.id = ${line.variantId} AND v.product_id = ${line.productId}
        AND v.is_active AND v.availability AND v.stock_quantity >= ${line.quantity}
        AND EXISTS (SELECT 1 FROM products p WHERE p.id = v.product_id
          AND p.store_id = ${storeId} AND p.is_active AND p.availability)
      RETURNING v.id`);
    if (updated.rows.length !== 1) {
      const current = await tx.execute(sql`SELECT v.stock_quantity, v.is_active AND v.availability AND p.is_active AND p.availability AS available
        FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.id = ${line.variantId} AND v.product_id = ${line.productId} AND p.store_id = ${storeId}`);
      const row = current.rows[0];
      throw stockError(!row || !row.available ? "VARIANT_UNAVAILABLE"
        : row.stock_quantity === 0 ? "OUT_OF_STOCK" : "INSUFFICIENT_STOCK", line);
    }
  }
}

/** Parent order is already locked and the terminal transition has been authorized. */
export async function restoreOrderStock(tx: InventoryTransaction, id: string) {
  const claimed = await tx.execute(sql`UPDATE orders SET inventory_state = 'RESTORED'
    WHERE id = ${id} AND inventory_state = 'DEDUCTED' AND status IN ('CANCELLED', 'REJECTED')
    RETURNING store_id`);
  if (claimed.rows.length === 0) return false; // Legacy NONE and already-restored orders never add stock.
  const storeId = claimed.rows[0]!.store_id as string;
  const items = await tx.execute(sql`SELECT variant_id, product_id, SUM(quantity)::integer AS quantity
    FROM order_items WHERE order_id = ${id} GROUP BY variant_id, product_id ORDER BY variant_id`);
  if (!items.rows.length) throw new HttpError(409, "This order's stock could not be restored safely.");
  for (const item of items.rows) {
    const updated = await tx.execute(sql`UPDATE product_variants v SET stock_quantity = v.stock_quantity + ${item.quantity}, updated_at = GREATEST(clock_timestamp(), v.updated_at + interval '1 millisecond')
      WHERE v.id = ${item.variant_id} AND v.product_id = ${item.product_id}
        AND ${item.quantity} > 0 AND v.stock_quantity <= 2147483647 - ${item.quantity}
        AND EXISTS (SELECT 1 FROM products p WHERE p.id = v.product_id AND p.store_id = ${storeId})
      RETURNING v.id`);
    if (updated.rows.length !== 1) throw new HttpError(409, "This order's stock could not be restored safely. Please review variant stock before retrying.");
  }
  return true;
}

/** Called after the same per-customer lock as checkout/cart mutations. */
export async function checkoutReplay(tx: InventoryTransaction, customerId: string, request: { idempotencyKey: string; cartId: string; addressId: string }) {
  const existing = await tx.execute(sql`SELECT id, checkout_key, checkout_cart_id, checkout_address_id FROM orders
    WHERE customer_id = ${customerId} AND (checkout_key = ${request.idempotencyKey} OR checkout_cart_id = ${request.cartId})`);
  if (!existing.rows.length) return null;
  const row = existing.rows[0]!;
  if (existing.rows.length !== 1 || row.checkout_cart_id !== request.cartId || row.checkout_address_id !== request.addressId)
    throw new HttpError(409, "This checkout request was already used for another cart or address. Please check your order history before trying again.", undefined, "IDEMPOTENCY_CONFLICT");
  return row.id as string;
}