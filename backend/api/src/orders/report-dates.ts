import { sql, type SQL } from "drizzle-orm";
import { orders } from "@workspace/db";
import { calendarDateSchema } from "@workspace/validation";
import { HttpError } from "../http.js";

export type OrderDateFilter = {
  dateFilter?: "RECENT"|"WEEK"|"FIFTEEN_DAYS"|"MONTH"|"CUSTOM"|"ALL";
  startDate?: string; endDate?: string;
};
export function indiaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
export function dailyBounds(date: string) {
  if (!calendarDateSchema.safeParse(date).success) throw new HttpError(400,"Use a valid reporting date.");
  const start = new Date(`${date}T00:00:00+05:30`);
  return {start,end:new Date(start.getTime()+86_400_000)};
}
export function orderDateBounds(query: OrderDateFilter, now = new Date()) {
  const filter = query.dateFilter ?? "ALL";
  if (filter === "ALL" || filter === "RECENT") return null;
  if (filter === "CUSTOM") {
    if (!query.startDate || !query.endDate || query.startDate > query.endDate)
      throw new HttpError(400,"Choose a valid start and end date.");
    const start = dailyBounds(query.startDate).start, end = dailyBounds(query.endDate).end;
    return {start,end};
  }
  const days = {WEEK:7,FIFTEEN_DAYS:15,MONTH:30}[filter];
  const today = dailyBounds(indiaDate(now));
  return {start:new Date(today.start.getTime()-(days-1)*86_400_000),end:today.end};
}
/** Identical predicate for lists, counts and full (unpaginated) PDFs. */
export function orderDateWhere(query: OrderDateFilter, storeId?: string): SQL | undefined {
  const bounds = orderDateBounds(query);
  if (bounds) return sql`${orders.createdAt}>=${bounds.start} AND ${orders.createdAt}<${bounds.end}`;
  if (query.dateFilter === "RECENT") return sql`${orders.id} IN (
    SELECT recent.id FROM orders recent ${storeId ? sql`WHERE recent.store_id=${storeId}` : sql``}
    ORDER BY recent.created_at DESC,recent.id DESC LIMIT 50)`;
  return undefined;
}
