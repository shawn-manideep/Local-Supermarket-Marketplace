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