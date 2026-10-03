import type { OrderDetail } from "./api";
import { historicalVariantLabel } from "./vendor-orders";

const money = (value: string | number) => `₹${Number(value).toFixed(2)}`;

/** Read historical snapshots only; never rebuild an order from today's catalog. */
export function VendorOrderReceipt({ detail }: {
  detail: Pick<OrderDetail, "items" | "subtotal" | "deliveryFeeSnapshot" | "totalAmount">;
}) {
  return <div className="vendor-info-block">
    <h3 className="vendor-subtitle">Items Ordered</h3>
    <div className="vendor-receipt-items">
      {detail.items.map(item => <div className="vendor-receipt-row" key={item.id}>
        <div className="vendor-receipt-desc">
          <strong>{item.productNameSnapshot}</strong>
          <span className="vendor-purchased-variant">{historicalVariantLabel(item)}</span>
          <span className="vendor-text-muted">Qty: {item.quantity} · {money(item.productPriceSnapshot)} each</span>
        </div>
        <strong>{money(item.subtotal)}</strong>
      </div>)}
    </div>
    <h3 className="vendor-subtitle">Order Summary</h3>
    <div className="vendor-receipt-totals">
      <div className="vendor-receipt-row vendor-text-muted"><span>Subtotal</span><span>{money(detail.subtotal)}</span></div>
      <div className="vendor-receipt-row vendor-text-muted"><span>Delivery Fee</span><span>{money(detail.deliveryFeeSnapshot)}</span></div>
      <div className="vendor-receipt-row vendor-grand-total"><span>Total</span><span>{money(detail.totalAmount)}</span></div>
    </div>
  </div>;
}