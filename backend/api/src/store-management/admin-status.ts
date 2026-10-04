import { eq, sql } from "drizzle-orm";
import { getDb, stores } from "@workspace/db";
import { HttpError } from "../http.js";
import { canTransitionStoreStatus, type StoreStatus } from "./status.js";

export async function changeStoreStatus(storeId: string, status: StoreStatus, actorId: string, db = getDb()) {
  return db.transaction(async tx => {
    const [current] = await tx.select().from(stores).where(eq(stores.id, storeId)).limit(1).for("update");
    if (!current) throw new HttpError(404, "Store not found");
    if (!canTransitionStoreStatus(current.status, status)) {
      throw new HttpError(409, `Store cannot transition from ${current.status} to ${status}`);
    }
    await tx.execute(sql`SELECT set_config('app.admin_actor_id',${actorId},true)`);
    const [updated] = await tx.update(stores).set({ status }).where(eq(stores.id, storeId)).returning();
    return updated!;
  });
}