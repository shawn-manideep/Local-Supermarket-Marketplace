# Phase 2 Database Schema

The first migration creates these application tables:

- `user_profiles`
- `customers`
- `customer_addresses`
- `stores`
- `store_service_pincodes`
- `store_operating_hours`
- `categories`
- `products`
- `carts`
- `cart_items`
- `orders`
- `order_items`
- `order_status_history`

Supabase Auth's existing `auth.users` table is referenced by
`user_profiles.id`. A database trigger creates a customer profile and customer
row for newly registered Auth users. Vendor and admin roles are provisioned
manually; public users cannot assign themselves either role.

Important relationships:

- One authenticated user maps to one `user_profiles` row.
- A customer profile uses the same identifier as its application user profile.
- A vendor owns exactly one store through the unique `stores.owner_user_id`
  relationship.
- Categories belong to one store.
- Products belong to one store and may reference a category owned by that same
  store. There is no global product catalog or `store_products` table.
- An active cart belongs to one customer and one store. A partial unique index
  enforces one active cart per customer/store pair.
- Orders belong to one customer and one store. Order items preserve product name
  and price snapshots, while orders preserve address, contact, fee, total, and
  commission snapshots.

Store status is limited to `PENDING_APPROVAL`, `ACTIVE`, `SUSPENDED`, and
`REJECTED`. Cart status is limited to `ACTIVE`, `ABANDONED`, and `CONVERTED`.
Order status includes the six normal states and `REJECTED`/`CANCELLED`.
Delivery types are `vendor_staff` and `platform_partner`; payment method is
currently `COD`.

Products and categories use `is_active`. Product `availability` remains a
separate flag, so disabling a product and temporarily making it unavailable
are distinct operations.

## Phase 4 catalog integrity

Phase 4 reuses the existing `categories` and `products` tables without a new
migration:

- Every category belongs directly to one store.
- Every product belongs directly to one store and may belong to one category.
- The composite foreign key from `(products.store_id, products.category_id)` to
  `(categories.store_id, categories.id)` prevents cross-store category
  assignment.
- Category names are unique only within a store.
- Non-null SKU and external code values are unique only within a store. Both
  fields may be null.
- Product names are not globally unique and are not permanent identifiers.
- Price uses `numeric(12,2)` with a non-negative database check.
- Stock uses an integer with a non-negative database check.
- Database triggers prevent hard deletion of categories and products.

There is no global product/category master and no `store_products` table. Two
stores selling the same item retain separate product records.

## Phase 8 order data and integrity

`orders` belongs to exactly one customer and store and stores:

- `status`, `delivery_type` (currently `vendor_staff`), and `payment_method`
  (currently `COD`);
- bigint-cent-derived `subtotal`, `delivery_fee_snapshot`, and `total_amount`;
- `commission_rate_snapshot` and `commission_amount_snapshot`;
- delivery address JSON plus contact snapshots and timestamps.

`order_items` retains product identity (where available), product name and
price snapshots, quantity, and line subtotal. `order_status_history` is an
append-only event stream with status, optional note, actor, and timestamp.
Orders start `PLACED`; the legal lifecycle is
`PLACED→ACCEPTED→PREPARING→READY→OUT_FOR_DELIVERY→DELIVERED`, with
`PLACED→REJECTED` and customer `PLACED→CANCELLED` terminal branches.

Order creation converts the source `ACTIVE` cart to `CONVERTED` in the same
READ COMMITTED transaction, after a per-customer advisory lock, as order and
history insertion. Current product
prices, availability, stock, store status/service coverage, address
ownership, and minimum order are revalidated at that boundary. No stock
deduction or reservation columns/ledger are introduced. COD has no payment
capture at placement. Commission calculations use integer cents and half-up
rounding; a missing store rate snapshots the explicit `0.00%` fallback because
no previous platform default configuration exists.

Migration `0003_harden_order_history.sql` hardens these invariants by making
status history update/delete-protected and revoking direct history writes from
`anon` and `authenticated`. It also revokes direct public order/order-item
writes and removes the broad admin mutation policy while preserving authorized
reads. It
prevents changing order customer/store identity or order-item order/product
identity. Historical snapshots and history are therefore not rewritten as
current catalog, address, ownership, or status data changes.