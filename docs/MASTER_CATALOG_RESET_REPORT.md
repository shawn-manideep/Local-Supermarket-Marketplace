# Master Catalog Reset — Implementation Report

Status: **Completed in the development environment. Owner approved preserving newer/edited records. No production publish or unrelated feature work.**

## Completed result

- Archived 181 confirmed seeded master products and 24 unchanged seeded categories; no rows were deleted.
- Preserved **Pulses**, **Atta & Flours**, **sabudana**, and **Cinnamon** as active, as explicitly approved. sabudana and Cinnamon retain their existing pending classification.
- Preserved archived Alshanthalu and all 17 already-archived test products and six already-archived test categories.
- Final totals: 201 master products (2 active, 199 archived), 32 master categories (2 active, 30 archived). All original IDs and references remain intact.
- Future master authoring is Admin-only. Vendors retain search, browsing and explicit add-to-own-store.
- Added category search/status filtering and product status/category filtering to the existing Admin panel. Admin views default to active; archived data remains reviewable and restorable.
- No example grocery catalog, variants, sample accounts or sample listings were created.

The following inventory and record tables were produced **before** modification and intentionally retain their original states/proposed treatment as the preflight evidence. Every row marked “Archive seeded category” or “Archive; retain identity/references” was subsequently archived; preservation rows were left untouched.

## Inventory and proposed scope

Current development database: 32 master categories, 201 master products. The original seeded batch contains 25 categories and 181 products created together on 2026-10-01. Existing catalog verification scripts explicitly document the 25-category/181-product seeded baseline. All 181 seed products retain their original timestamps, with no later edits. Seventeen explicitly named test/harness products and six test categories are already archived.

Three non-seed products cannot safely be classified as demos: sabudana (active), Cinnamon (active), and Alshanthalu (already archived). The Pulses category was created after the seed batch. The seeded Atta & Flours category was edited on 2026-10-05 after its original creation. These newer/edited records are proposed for preservation unless the owner explicitly confirms otherwise.

## Classification

- A: confirmed seed/test masters with no listing, cart, order or mapping-audit references: 171.
- B: confirmed seed/test masters with vendor/cart references, without order/audit references: 14.
- C: confirmed seed/test masters with order-item or mapping-audit references: 13.
- D: non-seed provenance not confirmed as demo: 3.

Order references are evaluated through the existing order-item → vendor-listing → master relationship. Historical snapshots themselves must not be rewritten. Mapping-audit references are also protected.

## Recommended operation

Archive the 181 confirmed seeded products and 24 unchanged seeded categories through the existing is_active lifecycle. Leave already archived test records archived. Preserve the two newer/edited active categories (Pulses and Atta & Flours), the two active unconfirmed products (sabudana and Cinnamon), and archived Alshanthalu. Keep every row/ID/reference; perform no hard deletion. Stop for owner confirmation before applying this scope.

Separately enforce future Admin-only master authoring while retaining vendor browse/select/add-to-own-store. Extend existing Admin search/status filters where needed; do not introduce a second master catalog. No new example records will be created.

## All categories before changes

| ID | Name | Active | Listing references | Local category references | Proposed treatment |
|---|---|---|---:|---:|---|
| 7b0c45c8-6623-4141-ab02-cad77928d1d7 | TEST Phase12 0bd69eb8-1e5c-41b2-bf25-770ab81dfa38 Grocery | No | 2 | 0 | Retain archived|
| c8cf0bb3-8cf1-4cbf-90e5-dca4dbc10186 | TEST Phase12 2b2d5444-701f-41c0-966f-ae4f6766bc31 Grocery | No | 2 | 0 | Retain archived|
| b208bcce-0965-48de-a234-4b009005fba6 | TEST Phase12 310a468f-3f39-4d5e-8f5f-d4aff5d68e95 Grocery | No | 2 | 0 | Retain archived|
| 37ef60ed-9b74-45ba-9e0b-0fa121629b86 | TEST Phase12 11ac9452-0d27-4c13-b07c-7976159bc7b1 Grocery | No | 2 | 0 | Retain archived|
| 6aae32bd-8699-48d8-9be9-94aff734c17f | Rice & Grains | Yes | 2 | 0 | Archive seeded category|
| 599d13b9-f276-4fff-8cb3-2524a90e4254 | Dals & Pulses | Yes | 2 | 0 | Archive seeded category|
| 33888b90-5a67-4898-b32b-7def4ab516ad | Cooking Oils & Ghee | Yes | 0 | 0 | Archive seeded category|
| 3165968c-6d47-4f54-af50-0af58f8aa481 | Spices & Masalas | Yes | 0 | 0 | Archive seeded category|
| 2cc5e05d-6d13-4d9d-a2c7-8ad234c0e20c | Salt & Sugar | Yes | 0 | 0 | Archive seeded category|
| 8cf19213-c40a-4b28-a44c-9c4c8ae7c47a | Dairy & Milk Products | Yes | 0 | 0 | Archive seeded category|
| 0685101d-35cf-4543-924d-7c533835a530 | Eggs | Yes | 0 | 0 | Archive seeded category|
| 6e848585-4464-45a2-a96a-2150da137823 | Fruits | Yes | 0 | 0 | Archive seeded category|
| 802db4d5-75d0-456f-a1f9-5070585ff49e | Vegetables | Yes | 0 | 0 | Archive seeded category|
| 4c23b423-9a1e-43ae-8bac-1d2c7ab745cb | Biscuits & Cookies | Yes | 1 | 0 | Archive seeded category|
| 293ffa1b-c6bb-4555-ac6e-7108828a6ec3 | Bakery | Yes | 0 | 0 | Archive seeded category|
| 509db1fc-b8ff-4efc-9334-86bdcdbea696 | Snacks | Yes | 1 | 0 | Archive seeded category|
| f18013bc-1ef6-419c-9453-e714fb1074e7 | Chocolates & Sweets | Yes | 0 | 0 | Archive seeded category|
| 75272f41-3ab1-4e81-9fce-fad30ca086cd | Beverages | Yes | 0 | 0 | Archive seeded category|
| 2cfe663f-54db-4b96-945a-261c85b5a50d | Tea & Coffee | Yes | 0 | 0 | Archive seeded category|
| 8fc8f3b1-1788-4174-857c-5a1597d79bdb | Breakfast & Cereals | Yes | 0 | 0 | Archive seeded category|
| 123dfdd5-17d3-4dd9-9529-108fb9ed69ba | Packaged Foods | Yes | 0 | 0 | Archive seeded category|
| a1633c1a-594c-4223-8c9e-60972049d177 | Noodles & Pasta | Yes | 0 | 0 | Archive seeded category|
| 435151fa-19a8-4efa-a721-491be6bd27bb | Sauces & Spreads | Yes | 0 | 0 | Archive seeded category|
| b4cde976-26cb-4abc-ac3a-9ce7ae778f11 | Pickles | Yes | 0 | 0 | Archive seeded category|
| 96f41622-de32-49d1-916b-23046791590e | Baby Food | Yes | 1 | 0 | Archive seeded category|
| 49c67981-8a7e-4e26-9ae7-df725cc9d742 | Personal Care | Yes | 1 | 0 | Archive seeded category|
| 1772e3e3-d2d3-4337-b21f-fc415d0fa19a | Household Cleaning | Yes | 0 | 0 | Archive seeded category|
| 89204a74-5ffc-4d9d-805d-8eedeecd6d2d | Home & Kitchen Essentials | Yes | 1 | 0 | Archive seeded category|
| b09362ca-c8a1-41c7-abe8-37e2210d09e4 | TEST Phase12 856ed87a-d22f-476c-a25d-82733bda598d Grocery | No | 2 | 0 | Retain archived|
| b2e60de4-9871-4e9c-8823-c5dbaf59439c | TEST Phase12 e37d7080-b104-42eb-9d9c-5139f047a0fb Grocery | No | 2 | 0 | Retain archived|
| f35c6afc-bb83-4b2b-8173-5008a7c81adc | Pulses | Yes | 0 | 0 | Preserve pending confirmation|
| e3743a38-b113-4603-ad94-a63572b25603 | Atta & Flours | Yes | 1 | 0 | Preserve pending confirmation|

## All master products before changes

| ID | Name | Active | Class | Vendor listings | Cart items | Order items | Mapping audit | Proposed treatment |
|---|---|---|---|---:|---:|---:|---:|---|
| 9ecf978d-5974-4484-a024-4e6708f0c18b | TEST Phase12 0bd69eb8-1e5c-41b2-bf25-770ab81dfa38 Reference Item | No | C | 0 | 0 | 0 | 2 | Retain archived|
| f61be91b-75ca-4c37-9052-01025b5f4abd | TEST Phase12 0bd69eb8-1e5c-41b2-bf25-770ab81dfa38 Reviewed Item | No | C | 2 | 0 | 0 | 2 | Retain archived|
| bba56d22-0171-4dad-801c-e61230c13ec3 | TEST Phase12 2b2d5444-701f-41c0-966f-ae4f6766bc31 Reference Item | No | C | 0 | 0 | 0 | 2 | Retain archived|
| 2ed3fbb7-5e1e-43c2-8f39-bdad15d1e10d | TEST Phase12 2b2d5444-701f-41c0-966f-ae4f6766bc31 Reviewed Item | No | C | 2 | 0 | 0 | 2 | Retain archived|
| 067e1602-decc-4acd-93f3-b4f9a0078340 | TEST Phase12 310a468f-3f39-4d5e-8f5f-d4aff5d68e95 Reference Item | No | C | 0 | 0 | 0 | 2 | Retain archived|
| 77b4f8cc-4a87-4415-a3ca-e6bdd14ab4cd | TEST Phase12 310a468f-3f39-4d5e-8f5f-d4aff5d68e95 Reviewed Item | No | C | 2 | 0 | 0 | 2 | Retain archived|
| af5b077e-461b-4c80-abe3-aeb1c06089a4 | TEST Phase12 11ac9452-0d27-4c13-b07c-7976159bc7b1 Reviewed Item | No | B | 2 | 0 | 0 | 0 | Retain archived|
| c50300de-e24f-4138-8a14-e575be0a12ab | Sona Masuri Rice | Yes | B | 1 | 0 | 0 | 0 | Archive; retain identity/references|
| 46fd3f90-53c4-467e-ad2f-a690fa835f2a | Basmati Rice | Yes | B | 1 | 0 | 0 | 0 | Archive; retain identity/references|
| f3af263f-6243-4a39-bc59-39a91e836119 | Brown Rice | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| ab3d476d-bcfc-4cb9-bffa-dcc2af72e6d3 | Idli Rice | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| ceee1ec8-9dd7-4b46-8123-269d1618a602 | Ponni Rice | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 9ebbecbd-fd7a-4114-a344-58d5ed2db35e | Raw Rice | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 4911c898-253e-4e68-b361-17ff84e4e5f8 | Boiled Rice | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| ae19b52a-bcb7-4088-b058-50d74d64fd49 | Broken Rice | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| f01f4ead-c11d-4039-a33c-da7238a7118a | Wheat Atta | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 2c59cd2b-a789-413e-8f2a-603439b32d48 | Maida | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| f269f188-de4b-443d-a850-45015de131a7 | Rava | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 51a3316e-8f63-4c36-8b37-69a9e585b856 | Sooji | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 17876398-531d-440f-a184-012bf6dc141c | Besan | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 9479c967-84a2-4b30-80c3-76355d0dbf1e | Rice Flour | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 04ea3295-326b-422c-8dba-a91f25a2d8d9 | Multigrain Atta | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 79edfdcb-6d6b-4d11-a14f-3db6607682b2 | Corn Flour | Yes | C | 1 | 2 | 2 | 0 | Archive; retain identity/references|
| ace72b03-f8f8-4efd-bb7c-ba494565634e | Wheat Atta | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 03c9cd60-78bb-42d3-a027-4d6e8055830e | Toor Dal | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| eaa037c7-1cf4-4bf1-9408-61b9cea5a166 | Moong Dal | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 9da96fa5-ff2d-4f6a-8fe8-9e779a24fb41 | Masoor Dal | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 26c933c9-d53e-44f4-a60a-a1360239f391 | Chana Dal | Yes | C | 1 | 6 | 5 | 0 | Archive; retain identity/references|
| 62f51677-4de8-4c86-a303-c4b58201f340 | Urad Dal | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| cb04b23c-7431-4ff0-b4a3-8455811c48e5 | Kabuli Chana | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 6d5df27c-e3ec-4e44-bcb6-a3b97bd4a603 | Rajma | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 33f9643c-bf8f-4168-9fb3-f60a185848cf | Black Chana | Yes | B | 1 | 0 | 0 | 0 | Archive; retain identity/references|
| 096085fc-0619-40af-90ac-ef0f431a3901 | Sunflower Oil | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 42a675fe-fb90-48e9-aa27-f5c33d7bd83f | Groundnut Oil | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 789b9d81-39dd-4430-b19e-4dd99e2f6611 | Rice Bran Oil | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 44c170df-07d5-4ff0-8670-b76b0eccead3 | Mustard Oil | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 1f0a3dd0-b9f3-4c89-b5a1-6e289649108b | Coconut Oil | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| e535c65d-707d-4e28-8c8b-101ceff9c67a | Sesame Oil | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 0b4aa8f8-b19b-4532-8f9d-c4b1682291e9 | Ghee | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 480a9f64-f5d0-4e50-96d9-e91ce8a34b48 | Turmeric Powder | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 6c1ed084-679b-45ad-b85f-3f2cb15ec555 | Red Chilli Powder | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| cad5cebe-8e54-442f-8076-0e7a873c84cf | Coriander Powder | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| ab45d638-cefc-471c-8fe9-8cd7629499e7 | Cumin Seeds | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 98bf1646-39d4-4bd4-9f8a-9c9d1876f369 | Garam Masala | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 2dd39b88-3f3c-48d5-951b-d1d52d2f4376 | Black Pepper | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 935c7b67-9726-463f-a907-9cdfe738e4bd | Mustard Seeds | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| cfb958ee-7a17-4ba9-b234-6a8c020e8cdd | Iodised Salt | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| f53bce6e-17d9-47ff-a922-6a156c165d35 | Rock Salt | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 9b735164-7dce-4e09-b3b2-04d52cc68b2c | Black Salt | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 3bc31061-6692-441c-99e4-41d0e9590aa2 | White Sugar | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| a9943e82-61b8-4738-ad2e-9652866c2f22 | Jaggery | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| d9815cd6-b69f-4aee-b6de-2c36455bb207 | Brown Sugar | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| eab5dc8a-07e3-4868-82a0-8cf124a7b9c4 | Iodised Salt | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 426a34e4-695d-4aa8-bd50-329c0e9001b7 | Full Cream Milk | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| edbb4c40-b455-4b45-ab59-307a8c3ca48a | Toned Milk | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| bcf2aea2-5b28-4d2b-b60e-56a5ab115df5 | Double Toned Milk | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| c656c9be-9b76-4490-b2b6-1f185f39dfa7 | Curd | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| e1502a82-d418-4e93-b7e7-3cfcb7bb17c3 | Buttermilk | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 7e8cf552-102e-4b29-9fb3-9a09488d08a7 | Paneer | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 317f1c02-1c13-427e-9f2c-b2630c04f96b | Cheese | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| fc1bf56b-6a4e-4419-a801-c0e2fa75ad66 | Butter | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 88c1ea13-c716-435d-806d-b01a28eb30eb | Full Cream Milk | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 30d313d3-7c08-400d-978e-fddf3d6bcfa1 | Butter | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 5d49ebfd-bfa5-4cff-89fd-7d32f007e52f | Curd | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 75e2cd5a-11de-4154-911d-b8283a4b824b | Toned Milk | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 689f25bc-ba5e-45c8-be2c-5926395a6f7a | Regular White Eggs | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| ffdc7957-6f65-4402-b3cf-ade74e18be59 | Brown Eggs | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| b5ca1dba-46df-403d-b44d-19b44f432d4d | Country Eggs | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 328c0b1f-5051-4f3c-8e1b-fe3f95754a72 | Omega Eggs | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 6522e734-63db-476f-9dfa-62d676189fc2 | Apples | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 8f4c74be-2f02-4487-b760-a7a2ae9d1c90 | Bananas | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 622610a7-7eec-46e9-9427-6aa22f1167fd | Oranges | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| f32c5dec-34fe-4aba-8d53-1ec23e685216 | Mangoes | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 07deebc0-16a4-42a4-8be3-999580985ae7 | Grapes | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| dd170d43-5e98-4f18-902a-381b963d6587 | Pomegranates | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 6f6673a4-ee92-4183-88ee-ca13299593e4 | Papayas | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| a296cf9a-02c5-475c-a7ab-89a8ca99b787 | Potatoes | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 1a0b5796-a373-4538-aa3e-62e53c4988f9 | Onions | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 633dba44-8c59-46cb-bb00-940198d3f69b | Tomatoes | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 8a1943d5-939f-4d2c-a2f2-4a9b2ecf6b2e | Carrots | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 3f57b47a-07f7-46bf-a372-f4a356be78d2 | Cauliflower | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 0727d52d-8121-4b30-974c-cbd86a7038ab | Spinach | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 8f9461a7-a207-47e8-9ad1-36de480c41e0 | Green Peas | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| fcf62d2d-3a2f-4470-bddf-de0fd2a3b7fe | Marie Biscuits | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| a264302d-5091-4840-8ed8-23e8af9f936f | Digestive Biscuits | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 939533f0-348f-4dad-93a6-94ebe7259e52 | Cream Biscuits | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 367e11bd-1a86-4b56-8f1e-10b57a9a1f61 | Glucose Biscuits | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| cb7dd38e-7de4-4611-8a27-97dd7a7c5333 | Butter Cookies | Yes | B | 1 | 0 | 0 | 0 | Archive; retain identity/references|
| 0d9bd234-2971-46b9-a526-6cde9cebd6a1 | Coconut Biscuits | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 52699579-90cf-4ee4-93c3-06eb1d0ad8b3 | Salted Crackers | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 66738211-0acd-471a-b591-5c48cd61dd39 | White Bread | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| f7ccdce2-84e9-4aa9-a351-c07b77f17305 | Whole Wheat Bread | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 1d6d4c93-1729-4bd4-b07f-7f104e4ebade | Pav Buns | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 49edf581-91d2-41c1-8023-43395c307671 | Burger Buns | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| ce0d852c-6848-401f-9a4c-4bd6cc4b420e | Hot Dog Rolls | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 1cecd8ee-6fb8-4088-879c-14dd58edba51 | Plain Cake | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 77df14d9-22c7-4465-ac0e-c3814528b05b | Rusk | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 2cea72ce-4f09-45ef-85da-8708271d445e | Potato Chips | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 93fd9f50-2e4c-4b5b-8812-15da3408794c | Banana Chips | Yes | B | 1 | 0 | 0 | 0 | Archive; retain identity/references|
| db403f2a-f1f8-439d-a63c-820b1a5d9842 | Peanut Chikki | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 75872afe-4a45-4f11-a12e-daa1b35326b8 | Roasted Peanuts | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| e2e9f865-90ee-4ba9-bdd7-9086762b0b31 | Puffed Rice | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 43ca87cb-1346-4011-ae4a-c77088117167 | Mixture Namkeen | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 541a1e18-5ede-4996-b823-740f30297f34 | Popcorn | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| aa8b164b-3e67-4801-af72-3bd2a44e1542 | Milk Chocolate | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| d511e946-3983-40c0-b9b0-0b2da3f712db | Dark Chocolate | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| f2caecdd-ec38-457d-9a9e-3e9f47e351d9 | Chocolate Wafer | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| c7c773c6-498f-4fa6-9a59-9764ff092d50 | Ladoo | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 540d047a-8073-41ba-b4f7-9a0cf04d6821 | Gulab Jamun | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| e74b7b8a-941b-4efe-91f7-7ec4e8eac2d9 | Jalebi | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| ad084cae-52a9-4eab-b2f5-b56b4607e9a7 | Milk Peda | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 2b0ee40a-a387-4577-95a5-459d7e11c6f4 | Packaged Drinking Water | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 213ce39f-3b13-4da2-919d-5ee2dcff7e69 | Mango Drink | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 15d5f6f9-81af-46b7-a45a-bba14bfc16c9 | Lemon Drink | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 105799a4-a8e8-4a56-91a9-bf3f05a5e3b1 | Cola Soft Drink | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| e8b38d90-bd3f-40b9-ba1a-115855cb8aaf | Orange Soft Drink | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 9b08d55d-0e97-42a6-9c51-89cbd67f0afa | Coconut Water | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 48f4efd9-778a-4db4-8366-451625f32eae | Malt Beverage | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 84ee504e-0f8a-4443-ad00-f7883e285007 | Black Tea | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 1c7526e2-8cd2-4d0c-81b0-fb92f185d0e9 | Green Tea | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| c097fd0c-2551-4198-9c8d-0e104db8ccc3 | Tea Bags | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 436e68d6-d7ca-4603-918e-8ccf879ddaf6 | Instant Coffee | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 096ac3c2-1b03-4b7c-a41e-963c377de4fe | Ground Coffee | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| c7cf9e56-1572-47c2-be4f-577c9e24a72b | Filter Coffee Powder | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| c818f80d-afee-4ef5-b555-c97dd9dd8536 | Cardamom Tea | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 45560961-094b-4015-9b66-d07f7343bf87 | Rolled Oats | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| e5411bfa-8905-489e-b7e9-e17aba0080ec | Corn Flakes | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 3a17e3f9-9a20-4734-9da7-df5e72761839 | Muesli | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 8e312f30-f18d-4fcd-84c8-a0d7b82459bf | Poha | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| dab7edcf-f06f-4b87-b86b-e923638f272f | Breakfast Cereal | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 91fcfbc6-65a2-41c8-89d1-434d32842124 | Pancake Mix | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| f22beaef-e781-4c7b-b040-ffbfa43addbd | Choco Cereal | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 322c56cc-0513-4b72-9f7d-88aa14ca22ab | Canned Sweet Corn | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| b59af004-e7bd-4551-94e7-ed43627c9b98 | Canned Baked Beans | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 8ef48690-7ade-491e-9545-fb16b7529e46 | Instant Soup | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 6f73b839-ec22-4620-916b-94ce871cf0a0 | Ready-to-Eat Dal | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| db09fd2e-345e-40c5-a216-ba33b616af07 | Coconut Milk | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| d3f13f0e-91f5-4e61-8804-235be6e0af72 | Vinegar | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| fc76acbc-8aa8-46aa-b916-dc8ccc4bbfce | Tinned Tomato Puree | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 03f1ebde-46d3-43ae-af92-eaeba562e94c | Instant Noodles | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| b735c706-b88c-4823-a154-18f4f4ad57f9 | Spaghetti | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 9557a824-bddb-4199-aac6-040005a29b43 | Penne Pasta | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 3464318e-9863-436c-96b6-32bfbc85327b | Macaroni | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 0ad633fc-e073-4037-b195-965ee31d9d22 | Vermicelli | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 22f9b004-e194-41b5-9d5a-380dce07ca32 | Rice Noodles | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 0fdee16d-e4f0-46ea-ac2e-6d32d0edf067 | Lasagne Sheets | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| ebf82c24-4ed2-497e-8c47-b684ba215378 | Tomato Ketchup | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 94fcbc39-3ab2-4a51-a697-98812b391aa0 | Mayonnaise | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| cb4e2f07-308a-4acf-a48e-398c9ce59439 | Green Chilli Sauce | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| fa09b907-eac0-48bc-aa15-ff6331ece075 | Soy Sauce | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 0f70bc29-52fd-477a-a653-e38d9e41f4b0 | Peanut Butter | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 8c62ac64-80f2-4c80-b6af-12bcf48b3b39 | Fruit Jam | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 68d146ef-4856-4998-ac11-09eaaf1b3530 | Mixed Fruit Preserve | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 1129ec58-07fb-4deb-8434-002a7a809c43 | Mango Pickle | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 4f46aaf1-b343-42c1-aea5-e16f0357017b | Lime Pickle | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| a72bf0d7-3f58-4abc-89e1-7ff17c64d9ec | Mixed Vegetable Pickle | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 077f143d-03cb-4e96-867c-a668255b4c34 | Gongura Pickle | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 34b3ec96-5766-4d3c-be68-3f6d420eeb6c | Garlic Pickle | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 847aa630-41fc-48b9-b8b6-fe0faf2c0533 | Chilli Pickle | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 46c184fd-53cf-4a39-816f-8d3022c67294 | Ginger Pickle | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| da3467b3-1d0e-4ac6-9360-61dc6cf593f3 | Infant Cereal | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 40dac581-4416-43a5-8719-910d21f9f7a0 | Baby Rice Cereal | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| d6293538-e0d1-4444-8c4f-104db5a1cde0 | Baby Oat Cereal | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 1111207b-4bf0-444b-80d4-a807648b04ed | Fruit Puree | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| fee5beb9-dbaf-4c70-9405-7a01eaed9b5d | Vegetable Puree | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 04d6c2f0-4e08-41aa-97fa-af957329c9c9 | Baby Biscuits | Yes | B | 1 | 0 | 0 | 0 | Archive; retain identity/references|
| 79ff60ad-86f3-4441-946a-cca16521c9fe | Follow-on Cereal | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| d0d04cd6-7b5b-4ae0-bbc2-866f6db9c865 | Bathing Soap | Yes | C | 1 | 1 | 1 | 0 | Archive; retain identity/references|
| b21b0890-46d9-4112-9e45-502d966d1ba6 | Shampoo | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 1de318ed-e494-47ef-a961-15053f4a253a | Toothpaste | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| f1ae68a4-e0d4-46d9-9104-ec0a332d00d4 | Toothbrush | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| db95aab0-1505-4f20-a6bd-f54e41a1d156 | Hair Oil | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 18f799ab-6765-47ed-8aa9-09e877e22618 | Body Lotion | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 06e11421-407a-469c-8d0d-cd80e590daf0 | Hand Wash | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 13e4f9cc-5fd1-42d5-a07c-807be7022d20 | Laundry Detergent | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 5922dd7b-0152-4181-bc5e-dd45022b81d8 | Dishwashing Liquid | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| cceb8c15-2680-4cb7-ab34-3ea376938a6d | Floor Cleaner | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| b3e6ebd9-6cdc-438c-b3ab-2e0a2dad9776 | Toilet Cleaner | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 91c05ebe-949e-4460-bb87-ed683a52d953 | Laundry Soap Bar | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| f110dd03-91ea-4a9f-9804-4a9323eb89c8 | Fabric Softener | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| a3fba40e-8925-40de-bf18-adee671c37a7 | Glass Cleaner | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 99caaeb4-5997-49ed-af04-fe0475c50691 | Kitchen Sponge | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 7cb15ea8-1af4-4d39-baa9-f8c3638a7fe2 | Scrub Pad | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| f8d5f5e2-7957-4d4e-b080-942e5b0c27c5 | Aluminium Foil | Yes | B | 1 | 0 | 0 | 0 | Archive; retain identity/references|
| fb41b869-33ec-467b-a45b-3b51dae627a8 | Cling Film | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| c4679cf2-b087-4f56-8a77-e0757396a8c9 | Garbage Bags | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 9f380468-f31c-4edf-884a-0e8e59058226 | Food Storage Container | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| 86745f98-49d0-440d-8c42-9f2ac2786279 | Paper Towels | Yes | A | 0 | 0 | 0 | 0 | Archive; retain identity/references|
| e57440ae-6985-40b9-8ee6-9a5592ea4e4f | sabudana | Yes | D | 1 | 0 | 0 | 0 | Preserve pending confirmation|
| 3af6d5c9-506f-4e6b-91e9-0b3b30c7b563 | Virelune08bb2a2ab6a14fdf9422dce57670a4a7 | No | B | 1 | 0 | 0 | 0 | Retain archived|
| e7921669-d33f-4cba-a242-56feff148c35 | Qorvellan 9bd2ea60-d50d-4bee-a183-c0116e5db2fe | No | B | 1 | 0 | 0 | 0 | Retain archived|
| 6280d835-c0be-4410-a3cc-037bf924b5b2 | Virelune0280cb4cdd9943de95911dfd682e21ab | No | B | 1 | 0 | 0 | 0 | Retain archived|
| 9b2f3a93-8553-4154-8efb-475673b29463 | Virelune724aa2fe9ab9447e8ee87e82825df6a5 | No | B | 1 | 0 | 0 | 0 | Retain archived|
| e7257028-b1c8-456a-a133-8ce5f6ba70b0 | Virelune3ecab25a2ebd4603971430916598aaa2 | No | B | 1 | 0 | 0 | 0 | Retain archived|
| 122bc762-ccd1-482f-8558-b12ea0a80f7e | Virelunec2cf149439c340049b1dd811aaf3f051 | No | B | 1 | 0 | 0 | 0 | Retain archived|
| cf52490a-f0f0-463e-b846-1da59357239a | Cinnamon | Yes | D | 1 | 1 | 0 | 0 | Preserve pending confirmation|
| 4ed86d31-19da-49eb-bb2a-bfcf889f95d2 | TEST Phase12 856ed87a-d22f-476c-a25d-82733bda598d Reference Item | No | C | 0 | 0 | 0 | 2 | Retain archived|
| c4644d08-c125-4d7e-8782-e6a71c1f8e4b | TEST Phase12 856ed87a-d22f-476c-a25d-82733bda598d Reviewed Item | No | C | 2 | 0 | 0 | 2 | Retain archived|
| 81b0fbdb-91c9-4487-afce-19cca769a36a | TEST Phase12 e37d7080-b104-42eb-9d9c-5139f047a0fb Reference Item | No | C | 0 | 0 | 0 | 2 | Retain archived|
| a102f6f7-d8d0-44da-a538-51b8f41149cc | TEST Phase12 e37d7080-b104-42eb-9d9c-5139f047a0fb Reviewed Item | No | C | 2 | 0 | 0 | 2 | Retain archived|
| dbd47b8b-eaae-44ec-92a0-55cf1792db1b | Alshanthalu | No | D | 1 | 4 | 3 | 0 | Preserve pending confirmation|

## Protection and remaining work

No accounts, stores, selling data, variants, carts, orders, history or delivery state have been modified. No destructive deletion, schema migration, automated browser testing or deployment was performed.

## Reset execution and database protection

Applied `database/maintenance/master_catalog_demo_reset.sql` once to the established development Supabase project. This is a reviewed maintenance operation, **not** a startup seed, deployment hook or automatic production migration.

The script:

- Uses the explicit 181-product/24-category ID allowlists from the pre-change report rather than deleting by name or blindly retiring every category.
- Acquires the existing canonical-write advisory lock and a master-table write lock, with repeatable-read transaction isolation.
- Rejects missing allowlisted records or active seed records edited since inspection.
- Updates only `is_active` and the existing master `updated_at` lifecycle field.
- Skips already-archived rows, so rerunning the same approved operation does not rewrite their timestamps.
- Compares all protected public-table fingerprints inside the transaction and aborts on an unexpected change.
- Also checks that all canonical metadata/IDs, and every non-allowlisted master row including its timestamp/status, remain unchanged.
- Does not alter foreign keys, RLS, triggers, permissions, schema, mappings, order snapshots or selling configuration.

No schema migration was needed, and no existing migration was edited. Any future use of this maintenance script requires deliberate target/scope review; it must not be run automatically when publishing.

An independent read-only comparison before and after execution confirmed identical full-row fingerprints for all 20 protected tables. Evidence: `docs/MASTER_CATALOG_RESET_PRESERVATION.json`.

| Protected table | Rows before / after | Full-row fingerprint |
|---|---:|---|
| user_profiles | 16 / 16 | Unchanged |
| identity_usernames | 2 / 2 | Unchanged |
| customers | 11 / 11 | Unchanged |
| customer_addresses | 6 / 6 | Unchanged |
| stores | 3 / 3 | Unchanged |
| store_operating_hours | 21 / 21 | Unchanged |
| store_service_pincodes | 5 / 5 | Unchanged |
| categories (store-owned) | 3 / 3 | Unchanged |
| products (vendor listings) | 41 / 41 | Unchanged |
| product_variants | 89 / 89 | Unchanged |
| carts | 58 / 58 | Unchanged |
| cart_items | 74 / 74 | Unchanged |
| customer_repeat_requests | 6 / 6 | Unchanged |
| orders | 26 / 26 | Unchanged |
| order_items | 43 / 43 | Unchanged |
| order_status_history | 84 / 84 | Unchanged |
| delivery_partner_profiles | 1 / 1 | Unchanged |
| delivery_assignments | 4 / 4 | Unchanged |
| master_mapping_audit | 10 / 10 | Unchanged |
| platform_management_events | 6 / 6 | Unchanged |

Auth endpoints and authentication code were not changed; no Auth account operations were performed. Auth tables are not exported in the evidence above.

## Admin category and product functionality

Existing Admin role-checked create/edit/archive/unarchive APIs remain the authoring boundary. Existing database-generated IDs remain immutable; strict update schemas do not accept identity replacement fields. Category editing changes the name, not its ID.

- Categories: create, view, name edit, archive/reactivate, case-insensitive search and active/archived/all filtering.
- Products: create under an active category, search name/brand/description/discovery attributes, view/edit supported canonical fields, archive/reactivate, active/archived/all filtering and category filtering.
- Supported canonical fields remain category, name, brand, description, image URL and existing discovery attributes. No arbitrary extra columns were added.
- Archive/status changes refresh the visible product list. Category editing/status responses retain the product counts already loaded.
- Existing duplicate detection includes archived identities. Admin must restore or deliberately edit an existing identity rather than create an identical replacement with a new ID.
- Archive review remains available; this reset does not erase historical canonical records.

## Vendor behavior

- Removed the missing-product authoring form and creation action from the Vendor panel.
- The legacy vendor master-product POST now returns HTTP 403 before validation, canonical queries or mutations. A duplicate-review token cannot enable vendor authoring.
- Admin category creation remains Admin-role protected; vendor-owned local categories are not global master authoring.
- Vendor master search/detail/add-to-store continue requiring active products and, when assigned, active categories. Pending active products remain selectable.
- Vendor category counts now count only active master products.
- The legacy duplicate-check endpoint remains read-only for compatibility; it cannot create/reactivate a master and no longer drives a Vendor authoring UI.
- Missing-product guidance directs vendors to Admin. Search, category browsing, pagination and “Add to My Store” are retained.
- Add-to-store resolves store ownership from the authenticated vendor and inserts only that store's listing. No broadcast insertion into another vendor's store was introduced.
- Existing listing identity, price, stock, availability, SKU, external code and variants were not changed.
- Adding a product still creates the existing unpublished, unconfigured store listing; vendors must configure their own selling options before publishing.

## Customer behavior

Customer shopping, carts, checkout, order inventory locking and reorder code were not changed. Customer reads remain store-listing based, not direct master-catalog browsing. The existing customer product queries do not exclude a still-active store listing merely because its referenced master has been archived.

Consequently, an existing selected demo product may still be visible/sellable through an active vendor listing under the unchanged availability/variant rules. This is intentional protection of vendor commercial data, **not** exposure as a new active master choice. New master identities do not reach customers until selected/configured/published by a vendor. Historical references/snapshots remain valid.

## Excel compatibility

The existing canonical master tables remain the source of truth. No parallel Excel catalog/table or schema was introduced. Stable master/category IDs, lifecycle flags and protected relationships remain compatible with the existing Admin workbook tooling.

The workbook implementation was not changed. Its two existing test failures are recorded below; this task does not claim that the broader Excel workflow is fully validated.

## Files changed

- `database/maintenance/master_catalog_demo_reset.sql` — explicit guarded, idempotent archival maintenance operation.
- `packages/validation/src/index.ts` — separate Admin query schema with validated lifecycle filter; vendor query schema unchanged.
- `backend/api/src/master-catalog/routes.ts` — forbid vendor master creation, active vendor category counts, Admin lifecycle filter.
- `apps/dashboard/src/AdminMasterCatalogPanel.tsx` — category search/status and product status/category filters; active defaults and list freshness.
- `apps/dashboard/src/VendorMasterCatalogPanel.tsx` — remove global authoring; retain store selection and explain Admin ownership.
- `apps/dashboard/src/api.ts` — remove unused vendor authoring input type.
- `backend/api/src/master-catalog/routes.test.ts` — explicit write-free creation denial and focused panel contract checks.
- `backend/api/src/master-catalog/validation.test.ts` — Admin lifecycle query validation.
- `backend/api/src/master-catalog/acceptance.integration.test.ts` — update the existing opt-in API acceptance scenario to expect vendor HTTP 403 and use Admin authoring. Not run against live data in this task.
- `docs/MASTER_CATALOG_RESET_REPORT.md` and `docs/MASTER_CATALOG_RESET_PRESERVATION.json` — preflight, completion report and preservation evidence.

No customer, cart, order, delivery, account/authentication or store-management implementation files were changed.

## Verification results and limitations

- Validation package build: passed.
- Database package build: passed.
- Focused master routes/validation/duplicate-review/seed-provenance and store catalog-management tests: **39 passed, 0 failed**. Dataset tests read the existing seed source only; they do not seed data.
- API typecheck: passed.
- Dashboard production build: passed.
- Dashboard typecheck: still reports **97 existing errors**, with no errors in the changed Admin/Vendor catalog panels. This task did not fix unrelated dashboard test typing.
- Initial broader catalog test run: 67 passed, 3 failed, 1 skipped. The newly added denial test initially checked the wrong error property; it was corrected and passed in the focused run. The other two failures occur in unchanged `excel-workbook.test.ts` / workbook code:
  1. Header comparison distinguishes ExcelJS's sparse first array element from explicit `undefined`.
  2. The empty-workbook fixture is accepted although its test expects rejection.
- Opt-in live API acceptance was not run, to avoid creating additional test catalog or commercial records.
- Guarded transaction and independent database read-back: all 20 protected-table fingerprints identical; zero active confirmed seed products, zero active unchanged seed categories; only the approved preserved entries remain active.
- API and dashboard workflows restarted successfully; API `/api/health` returns HTTP 200.
- A passive screenshot confirmed the unsigned-in dashboard renders. This does **not** claim validation of signed-in Admin/Vendor flows. No automated browser test, interaction, sign-in, checkout or data mutation was performed.
- Development only: no production database reset or application publish was performed.

## Manual browser acceptance steps

Use your existing accounts and your own actual catalog names; these steps have not been executed automatically.

1. Sign in as Admin and open **Master Catalog**. Active defaults should show only the preserved active records, not the 181 retired seed products.
2. Switch product/category status to **Archived**. Search for a known seed product (for example Corn Flour) and verify its archived status. Confirm existing IDs remain visible in exports/API records and referenced listings remain present.
3. Switch back to **Active**. Confirm Pulses and Atta & Flours remain active; confirm sabudana and Cinnamon remain active/pending. Alshanthalu must remain archived.
4. Create one of your own real categories. Search for it, edit its name, then refresh/reopen the panel. Verify the same category ID is retained.
5. Create one of your own real master products in that category, using the existing name/brand/description/image fields. Confirm it appears after refresh and category/search filtering.
6. Edit that product and confirm its master ID remains unchanged. Archive it and confirm it leaves Active but appears in Archived. Reactivate it and verify it returns without a second identity.
7. Sign in as Vendor A and open **Master Catalog**. Search for the product by name/brand and browse its category. Confirm retired seed products are not offered as choices and there is no global product-authoring form.
8. Select **Add to My Store**. Verify exactly one Vendor A listing is created and reselecting it reuses the existing listing.
9. Sign in as Vendor B. The master is searchable globally, but Vendor B's **My Store** must not automatically contain Vendor A's listing.
10. Configure Vendor A's own variants, prices, stock and availability and publish through the existing workflow. If Vendor B also selects the product, configure different selling values; changes to one store must not change the other.
11. As a customer using an existing serviceable address/pincode, select Vendor A's store. Confirm the published product is available through that store. Before Vendor B selects/publishes it, confirm it is absent from Vendor B's store.
12. Review an existing order/history entry and an existing cart containing a retired seed listing. Confirm names/snapshots, totals, line items, status history and delivery assignment remain as before.
13. Reopen Admin and Vendor pages or refresh them to verify results persist. Archived records should only return to active master choices after explicit Admin restoration (and an active category when assigned).

**Stopped after this requested catalog reset and authoring change. No unrelated feature or automatic sample catalog was added.**
