# Customer portal improvements — implementation report

## Implemented scope

### 1. Structured delivery addresses
- Add and Edit now show required **House Number / Flat Number**, optional **Building Name / Apartment Name**, **Landmark**, and **Locality**, retaining recipient, phone, city, state, PIN and default-address controls.
- The API validates structured input and supports legacy `line1`/`line2` requests. Optional details can be explicitly cleared.
- Migration `0022_customer_structured_addresses.sql` adds four nullable columns. It does not backfill, reinterpret, delete, or overwrite old addresses.
- Legacy first/second lines are retained as editable text; they are not guessed into separate house/building/landmark components.
- A shared Customer formatter is used for saved addresses, checkout, reorder address selection and order details. Compatibility lines keep other existing consumers readable.
- New order snapshots include structured address details. Historical snapshots remain unchanged when addresses are edited.
- Address partial updates and default switches serialize per Customer; ownership checks remain in place.

### 2. Scheduled delivery availability
- The approved policy remains **complete one-hour slots, today and tomorrow, Asia/Kolkata**. No extra booking horizon or buffer was introduced.
- Today appears whenever it has eligible slots, including before the store opens. Started slots are excluded; if Today has none, the next eligible date is selected.
- Slots refresh on date selection, checkout re-entry, foreground/focus and periodically. Still-valid choices are retained; expired choices are cleared with an explanation.
- Checkout validates the exact canonical window again using the database clock and current operating hours before stock/order writes.
- Administrative unavailability still rejects new orders. Daily closure blocks **Instant**, but permits **Scheduled** for a valid future slot.
- Cart additions and reorder eligibility use the same open-or-future-scheduled rule; closure is not reported as stock depletion.

### 3. Closed-store notice
- Selected closed-store shopping views show an inline light-pink notice with a red heading and clock mark:
  - **We'll be back shortly!**
  - The scheduled-delivery invitation appears only when future slots are available.
  - The opening message uses the actual next opening in India time: today, tomorrow, or the correct later weekday/date.
- Next-opening calculation skips closed weekdays and missing hours. No opening time is fabricated when none is configured.
- The notice stays within the shopping layout, retaining browsing and existing search/product/cart navigation.
- Store availability refreshes on re-entry, foreground/focus and periodically.
- The supplied attachment contained written reference guidance, not a separate reference-image file; styling follows that guidance.

### 4. Customer navigation
- The bottom-nav label is **Reorder**.
- Its existing `orders` key, icon, destination, history and reorder flow remain unchanged.
- Vendor, Delivery Partner and Admin navigation were not changed.

## Data safety

The additive migration was applied to the existing **development** database only.
Before/after checks confirmed:
- All **9 existing addresses** retained their original values.
- Checked order, product, variant, cart, delivery, profile and Customer data fingerprints stayed identical.
- No production changes, publishing, seeded live test data or destructive migrations were performed.

Behavioral write tests used disposable PostgreSQL databases and synthetic identities.

## Verification

**134 distinct tests passed**, comprising:
- 71 API tests: address validation/authentication, delivery-slot rules, inventory transactions, and the document/order integration suite.
- 63 Customer regression and Delivery Partner workflow tests: address formatting, navigation, shopping/reorder/history behavior and scheduled fulfilment guards.

The final address integration pass additionally verified concurrent partial updates preserve both changes, cross-Customer GET/PATCH/DELETE denials, optional-field clearing, persisted read-back, closed-store Scheduled acceptance, Instant/expired-slot rejection without stock/order changes, administrative-unavailability rejection and immutable address snapshots.

Other successful checks:
- OpenAPI regeneration and shared TypeScript builds.
- API and Customer typechecks.
- Customer Expo web export.
- API and Customer workflows restarted and running.
- API health endpoint: HTTP 200.
- A 390 × 844 preview capture rendered the signed-out Customer screen.

**Verification limit:** The screenshot cannot sign in and does not constitute authenticated visual acceptance of the changed screens. No automated browser journey was run. Its capture logs included a resource 404 and a password-form warning, without preventing the sign-in screen from rendering.

## Manual preview checklist — authenticated visual checks

1. At 320px and 390px widths, create an address with house/flat, building, landmark and locality. Check blank-house validation, successful save, reload and checkout display.
2. Edit that address, clear optional fields and reload. Verify cleared details disappear without duplicating building/landmark text or losing other fields.
3. Open a legacy saved address. Confirm both old lines remain visible/editable. Inspect an older order before and after editing its saved address; its original delivery address must remain unchanged.
4. Use a store with eligible remaining Today slots. Confirm Today and Tomorrow choices show only full eligible windows; switch dates and reopen checkout.
5. Let a selected slot expire or change its operating hours. Confirm refresh removes it, clears the choice with a helpful message and prevents submission of the stale window.
6. Visit a daily-closed store with a future slot. Check pink/red clock notice, accurate next opening, browsing/Add availability, blocked Instant checkout and available Scheduled checkout.
7. Use hours with tomorrow closed. Confirm the notice identifies the next actual opening, not “tomorrow.” With no eligible slots, the scheduled invitation must not appear.
8. Confirm an administratively unavailable store cannot accept new orders despite future hours, while previously accepted delivery windows remain unchanged.
9. Tap **Reorder** in the Customer bottom navigation. Confirm the original Orders/history destination and icon, and unchanged other-portal navigation.

Implementation is complete within the requested four-part scope; the checklist above records the remaining authenticated visual acceptance.
