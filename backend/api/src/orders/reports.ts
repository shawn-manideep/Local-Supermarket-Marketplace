import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";
import { Router, type Response } from "express";
import { sql, and, eq, gte, lte } from "drizzle-orm";
import { getDb, orders } from "@workspace/db";
import { calendarDateSchema, adminOrderQuerySchema, vendorOrderQuerySchema } from "@workspace/validation";
import { z } from "zod";
import { requireRole } from "../auth/middleware.js";
import { requireDeliveryPartner } from "../delivery-partner/middleware.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { HttpError, asyncHandler } from "../http.js";
import { orderDateWhere, dailyBounds, indiaDate, type OrderDateFilter } from "./report-dates.js";

type ReportRow = Record<string, unknown>;
export function reportDate(value: unknown) {
  if (!value) return "Not recorded";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"}).format(date);
}
const amount = (value: unknown) => `INR ${String(value ?? "0.00")}`;
const text = (value: unknown) => String(value ?? "—");
async function pdf(title: string, subtitle: string, render: (doc: PDFKit.PDFDocument) => void) {
  return new Promise<Buffer>((resolve,reject) => {
    const doc = new PDFDocument({size:"A4",margin:44,bufferPages:true,info:{Title:title,Author:"Local Basket"}});
    // Embed licensed Latin/Telugu glyphs so entered names are not transliterated or lost.
    doc.registerFont("Report",fileURLToPath(new URL("./fonts/NotoSansTelugu.ttf",import.meta.url)));
    const chunks: Buffer[] = [];
    doc.on("data",chunk => chunks.push(chunk));
    doc.on("error",reject);
    doc.on("end",() => resolve(Buffer.concat(chunks)));
    doc.font("Helvetica-Bold").fontSize(21).fillColor("#186A45").text("LOCAL BASKET");
    doc.fillColor("#202B25").fontSize(15).text(title);
    doc.font("Helvetica").fontSize(9).fillColor("#59665F").text(subtitle);
    doc.text(`Generated ${reportDate(new Date().toISOString())} · All dates: Asia/Kolkata`);
    doc.moveDown().strokeColor("#B9D4C5").moveTo(44,doc.y).lineTo(551,doc.y).stroke().moveDown();
    doc.fillColor("#202B25").font("Report").fontSize(10);
    render(doc);
    const pages = doc.bufferedPageRange();
    for (let i=pages.start;i<pages.start+pages.count;i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font("Helvetica").fontSize(8).fillColor("#59665F").text(
        `Private operational report · Page ${i+1} of ${pages.count}`,44,doc.page.height-30,{lineBreak:false});
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}
async function sendPdf(response: Response, bytes: Buffer, name: string) {
  response.setHeader("Cache-Control","private, no-store");
  response.setHeader("X-Content-Type-Options","nosniff");
  response.setHeader("Content-Disposition",`attachment; filename="${name}"`);
  response.type("application/pdf").send(bytes);
}
function label(doc: PDFKit.PDFDocument, name: string, value: unknown) {
  doc.font("Helvetica-Bold").text(`${name}: `,{continued:true});
  doc.font("Report").text(text(value));
}
export async function orderReportRows(query: OrderDateFilter & {status?:string;storeId?:string;from?:string;to?:string}, ownedStoreId?: string) {
  const storeId = ownedStoreId ?? query.storeId;
  const where = and(storeId ? eq(orders.storeId,storeId) : undefined,orderDateWhere(query,storeId),
    query.status && query.status !== "ALL" ? sql`${orders.status}=${query.status}` : undefined,
    query.from ? gte(orders.createdAt,new Date(query.from)) : undefined,
    query.to ? lte(orders.createdAt,new Date(query.to)) : undefined);
  const result = await getDb().execute(sql`SELECT orders.id,orders.created_at AS "createdAt",orders.status,
    orders.store_id AS "storeId",s.name AS "storeName",s.owner_user_id AS "vendorId",s.owner_name AS "vendorName",
    coalesce(to_jsonb(c)->>'full_name',orders.delivery_contact_name) AS "customerName",
    orders.delivery_contact_name AS "recipientName",orders.delivery_contact_phone AS "contactPhone",
    orders.delivery_address_snapshot AS address,orders.subtotal,orders.delivery_fee_snapshot AS "deliveryFee",
    orders.handling_fee_snapshot AS "handlingFee",orders.total_amount AS total,
    (SELECT a.status FROM delivery_assignments a WHERE a.order_id=orders.id ORDER BY a.assigned_at DESC,a.id DESC LIMIT 1) AS "deliveryStatus",
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at,i.id) FROM order_items i WHERE i.order_id=orders.id) AS items
    FROM orders JOIN stores s ON s.id=orders.store_id JOIN customers c ON c.id=orders.customer_id
    ${where ? sql`WHERE ${where}` : sql``} ORDER BY orders.created_at DESC,orders.id DESC`);
  return result.rows;
}
export const reportsRouter = Router();
for (const vendor of [true,false]) {
  reportsRouter.get(vendor ? "/api/vendor/orders/report.pdf" : "/api/admin/orders/report.pdf",
    requireRole(vendor ? "vendor" : "admin"),asyncHandler(async(req,res) => {
      const parsed = (vendor ? vendorOrderQuerySchema : adminOrderQuerySchema).safeParse(req.query);
      if (!parsed.success) throw new HttpError(400,"Invalid order report filters.");
      const storeId = vendor ? (req as AuthenticatedRequest).auth!.storeId : undefined;
      if (vendor && !storeId) throw new HttpError(404,"Vendor store not found.");
      const rows = await orderReportRows(parsed.data,storeId ?? undefined);
      const filter = parsed.data as OrderDateFilter;
      const bytes = await pdf("Order report",`${filter.dateFilter ?? "ALL"}${filter.dateFilter === "CUSTOM" ? ` · ${filter.startDate} to ${filter.endDate}` : ""} · ${rows.length} orders`,doc => {
        if (!rows.length) doc.text("No orders match the selected filters.");
        for (const row of rows) {
          if (doc.y>doc.page.height-190) doc.addPage();
          doc.moveDown().font("Helvetica-Bold").fontSize(12).text(`Order ${row.id}`).fontSize(10);
          label(doc,"Placed",reportDate(row.createdAt));
          label(doc,"Store",`${row.storeName} (${row.storeId})`);
          label(doc,"Vendor",`${row.vendorName ?? ""} (${row.vendorId})`);
          label(doc,"Customer",row.customerName);
          label(doc,"Recipient / contact",`${row.recipientName} · ${row.contactPhone}`);
          const address = row.address as ReportRow;
          label(doc,"Delivery address",[address.line1 ?? address.addressLine1,address.line2 ?? address.addressLine2,
            address.city,address.state,address.pincode].filter(Boolean).join(", "));
          label(doc,"Order / delivery status",`${row.status} / ${row.deliveryStatus ?? "Not assigned"}`);
          doc.moveDown(0.4).font("Helvetica-Bold").text("Product / quantity and unit / unit price / line total").font("Report");
          for (const item of (row.items ?? []) as ReportRow[]) {
            const unit = [item.variant_name_snapshot,item.variant_quantity_value_snapshot,item.variant_quantity_unit_snapshot].filter(v=>v!=null).join(" ");
            doc.text(`${item.product_name_snapshot} · ${item.quantity} × ${unit || "item"} · ${amount(item.product_price_snapshot)} · ${amount(item.subtotal)}`);
          }
          label(doc,"Subtotal",amount(row.subtotal));
          label(doc,"Delivery fee",amount(row.deliveryFee));
          label(doc,"Handling fee",amount(row.handlingFee));
          doc.font("Helvetica-Bold").text(`ORDER TOTAL: ${amount(row.total)}`).font("Report");
          doc.moveDown().strokeColor("#DDE5E0").moveTo(44,doc.y).lineTo(551,doc.y).stroke();
        }
      });
      await sendPdf(res,bytes,`orders-${vendor ? storeId : "admin"}-${indiaDate()}.pdf`);
    }));
}
export const dailyReportQuery = z.object({date:calendarDateSchema,partnerId:z.string().uuid().optional()}).strict();
export async function dailyReportRows(date: string, partnerId?: string) {
  const {start,end} = dailyBounds(date);
  const result = await getDb().execute(sql`SELECT * FROM (
    SELECT DISTINCT ON(a.order_id) a.partner_user_id AS "partnerId",p.display_name AS "partnerName",
      a.id AS "deliveryId",a.order_id AS "orderId",o.total_amount AS amount,o.store_id AS "vendorId",
      s.owner_user_id AS "vendorAccountId",s.name AS "storeName",a.status,
      coalesce(a.delivered_at,a.picked_up_at,a.accepted_at) AS "deliveryAt"
    FROM delivery_assignments a JOIN orders o ON o.id=a.order_id JOIN stores s ON s.id=o.store_id
      JOIN delivery_partner_profiles p ON p.user_id=a.partner_user_id
    WHERE a.status IN ('ACCEPTED','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED')
      ${partnerId ? sql`AND a.partner_user_id=${partnerId}` : sql``}
    ORDER BY a.order_id,a.assigned_at DESC,a.id DESC
  ) report WHERE "deliveryAt">=${start} AND "deliveryAt"<${end} ORDER BY "deliveryAt","orderId"`);
  return result.rows;
}
for (const partner of [true,false]) {
  reportsRouter.get(partner ? "/api/delivery-partner/reports/daily.pdf" : "/api/admin/reports/deliveries/daily.pdf",
    partner ? requireDeliveryPartner() : requireRole("admin"),asyncHandler(async(req,res) => {
      const parsed = (partner ? dailyReportQuery.omit({partnerId:true}) : dailyReportQuery).safeParse(req.query);
      if (!parsed.success) throw new HttpError(400,"Use a valid day and permitted report filters.");
      const input = parsed.data as z.infer<typeof dailyReportQuery>;
      const partnerId = partner ? (req as AuthenticatedRequest).auth!.userId : input.partnerId;
      const rows = await dailyReportRows(input.date,partnerId);
      const bytes = await pdf("Daily delivery report",`${input.date} · ${partnerId ?? "All partners"} · ${rows.length} deliveries`,doc => {
        doc.fontSize(9).text("Completed deliveries use completion date. In-progress deliveries use pickup date, or acceptance date before pickup. Amounts are order totals, not partner earnings. Pending, rejected and cancelled offers are excluded.").moveDown().fontSize(10);
        if (!rows.length) doc.text("No deliveries match this day.");
        for (const row of rows) {
          if (doc.y>doc.page.height-165) doc.addPage();
          label(doc,"Partner",`${row.partnerName} (${row.partnerId})`);
          label(doc,"Delivery / Order",`${row.deliveryId} / ${row.orderId}`);
          label(doc,"Store / Vendor",`${row.storeName} (${row.vendorId}) / ${row.vendorAccountId}`);
          label(doc,"Delivery time / status",`${reportDate(row.deliveryAt)} / ${row.status}`);
          label(doc,"Order amount",amount(row.amount)); doc.moveDown();
        }
      });
      await sendPdf(res,bytes,`deliveries-${partnerId ?? "all"}-${input.date}.pdf`);
    }));
}
