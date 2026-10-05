-- Approved scope: 181 confirmed seeded products and 24 unchanged seeded categories.
-- Preserve newer/edited entries, all selling data, carts, orders and history.
-- Development-only operation; never run automatically at startup or deployment.
-- Explicit ID allowlist from docs/MASTER_CATALOG_RESET_REPORT.md preflight.
-- Idempotent: archived rows are not updated. No schema, privilege or RLS changes.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
DO $reset$
DECLARE
  product_ids uuid[] := ARRAY[
    'c50300de-e24f-4138-8a14-e575be0a12ab',
    '46fd3f90-53c4-467e-ad2f-a690fa835f2a',
    'f3af263f-6243-4a39-bc59-39a91e836119',
    'ab3d476d-bcfc-4cb9-bffa-dcc2af72e6d3',
    'ceee1ec8-9dd7-4b46-8123-269d1618a602',
    '9ebbecbd-fd7a-4114-a344-58d5ed2db35e',
    '4911c898-253e-4e68-b361-17ff84e4e5f8',
    'ae19b52a-bcb7-4088-b058-50d74d64fd49',
    'f01f4ead-c11d-4039-a33c-da7238a7118a',
    '2c59cd2b-a789-413e-8f2a-603439b32d48',
    'f269f188-de4b-443d-a850-45015de131a7',
    '51a3316e-8f63-4c36-8b37-69a9e585b856',
    '17876398-531d-440f-a184-012bf6dc141c',
    '9479c967-84a2-4b30-80c3-76355d0dbf1e',
    '04ea3295-326b-422c-8dba-a91f25a2d8d9',
    '79edfdcb-6d6b-4d11-a14f-3db6607682b2',
    'ace72b03-f8f8-4efd-bb7c-ba494565634e',
    '03c9cd60-78bb-42d3-a027-4d6e8055830e',
    'eaa037c7-1cf4-4bf1-9408-61b9cea5a166',
    '9da96fa5-ff2d-4f6a-8fe8-9e779a24fb41',
    '26c933c9-d53e-44f4-a60a-a1360239f391',
    '62f51677-4de8-4c86-a303-c4b58201f340',
    'cb04b23c-7431-4ff0-b4a3-8455811c48e5',
    '6d5df27c-e3ec-4e44-bcb6-a3b97bd4a603',
    '33f9643c-bf8f-4168-9fb3-f60a185848cf',
    '096085fc-0619-40af-90ac-ef0f431a3901',
    '42a675fe-fb90-48e9-aa27-f5c33d7bd83f',
    '789b9d81-39dd-4430-b19e-4dd99e2f6611',
    '44c170df-07d5-4ff0-8670-b76b0eccead3',
    '1f0a3dd0-b9f3-4c89-b5a1-6e289649108b',
    'e535c65d-707d-4e28-8c8b-101ceff9c67a',
    '0b4aa8f8-b19b-4532-8f9d-c4b1682291e9',
    '480a9f64-f5d0-4e50-96d9-e91ce8a34b48',
    '6c1ed084-679b-45ad-b85f-3f2cb15ec555',
    'cad5cebe-8e54-442f-8076-0e7a873c84cf',
    'ab45d638-cefc-471c-8fe9-8cd7629499e7',
    '98bf1646-39d4-4bd4-9f8a-9c9d1876f369',
    '2dd39b88-3f3c-48d5-951b-d1d52d2f4376',
    '935c7b67-9726-463f-a907-9cdfe738e4bd',
    'cfb958ee-7a17-4ba9-b234-6a8c020e8cdd',
    'f53bce6e-17d9-47ff-a922-6a156c165d35',
    '9b735164-7dce-4e09-b3b2-04d52cc68b2c',
    '3bc31061-6692-441c-99e4-41d0e9590aa2',
    'a9943e82-61b8-4738-ad2e-9652866c2f22',
    'd9815cd6-b69f-4aee-b6de-2c36455bb207',
    'eab5dc8a-07e3-4868-82a0-8cf124a7b9c4',
    '426a34e4-695d-4aa8-bd50-329c0e9001b7',
    'edbb4c40-b455-4b45-ab59-307a8c3ca48a',
    'bcf2aea2-5b28-4d2b-b60e-56a5ab115df5',
    'c656c9be-9b76-4490-b2b6-1f185f39dfa7',
    'e1502a82-d418-4e93-b7e7-3cfcb7bb17c3',
    '7e8cf552-102e-4b29-9fb3-9a09488d08a7',
    '317f1c02-1c13-427e-9f2c-b2630c04f96b',
    'fc1bf56b-6a4e-4419-a801-c0e2fa75ad66',
    '88c1ea13-c716-435d-806d-b01a28eb30eb',
    '30d313d3-7c08-400d-978e-fddf3d6bcfa1',
    '5d49ebfd-bfa5-4cff-89fd-7d32f007e52f',
    '75e2cd5a-11de-4154-911d-b8283a4b824b',
    '689f25bc-ba5e-45c8-be2c-5926395a6f7a',
    'ffdc7957-6f65-4402-b3cf-ade74e18be59',
    'b5ca1dba-46df-403d-b44d-19b44f432d4d',
    '328c0b1f-5051-4f3c-8e1b-fe3f95754a72',
    '6522e734-63db-476f-9dfa-62d676189fc2',
    '8f4c74be-2f02-4487-b760-a7a2ae9d1c90',
    '622610a7-7eec-46e9-9427-6aa22f1167fd',
    'f32c5dec-34fe-4aba-8d53-1ec23e685216',
    '07deebc0-16a4-42a4-8be3-999580985ae7',
    'dd170d43-5e98-4f18-902a-381b963d6587',
    '6f6673a4-ee92-4183-88ee-ca13299593e4',
    'a296cf9a-02c5-475c-a7ab-89a8ca99b787',
    '1a0b5796-a373-4538-aa3e-62e53c4988f9',
    '633dba44-8c59-46cb-bb00-940198d3f69b',
    '8a1943d5-939f-4d2c-a2f2-4a9b2ecf6b2e',
    '3f57b47a-07f7-46bf-a372-f4a356be78d2',
    '0727d52d-8121-4b30-974c-cbd86a7038ab',
    '8f9461a7-a207-47e8-9ad1-36de480c41e0',
    'fcf62d2d-3a2f-4470-bddf-de0fd2a3b7fe',
    'a264302d-5091-4840-8ed8-23e8af9f936f',
    '939533f0-348f-4dad-93a6-94ebe7259e52',
    '367e11bd-1a86-4b56-8f1e-10b57a9a1f61',
    'cb7dd38e-7de4-4611-8a27-97dd7a7c5333',
    '0d9bd234-2971-46b9-a526-6cde9cebd6a1',
    '52699579-90cf-4ee4-93c3-06eb1d0ad8b3',
    '66738211-0acd-471a-b591-5c48cd61dd39',
    'f7ccdce2-84e9-4aa9-a351-c07b77f17305',
    '1d6d4c93-1729-4bd4-b07f-7f104e4ebade',
    '49edf581-91d2-41c1-8023-43395c307671',
    'ce0d852c-6848-401f-9a4c-4bd6cc4b420e',
    '1cecd8ee-6fb8-4088-879c-14dd58edba51',
    '77df14d9-22c7-4465-ac0e-c3814528b05b',
    '2cea72ce-4f09-45ef-85da-8708271d445e',
    '93fd9f50-2e4c-4b5b-8812-15da3408794c',
    'db403f2a-f1f8-439d-a63c-820b1a5d9842',
    '75872afe-4a45-4f11-a12e-daa1b35326b8',
    'e2e9f865-90ee-4ba9-bdd7-9086762b0b31',
    '43ca87cb-1346-4011-ae4a-c77088117167',
    '541a1e18-5ede-4996-b823-740f30297f34',
    'aa8b164b-3e67-4801-af72-3bd2a44e1542',
    'd511e946-3983-40c0-b9b0-0b2da3f712db',
    'f2caecdd-ec38-457d-9a9e-3e9f47e351d9',
    'c7c773c6-498f-4fa6-9a59-9764ff092d50',
    '540d047a-8073-41ba-b4f7-9a0cf04d6821',
    'e74b7b8a-941b-4efe-91f7-7ec4e8eac2d9',
    'ad084cae-52a9-4eab-b2f5-b56b4607e9a7',
    '2b0ee40a-a387-4577-95a5-459d7e11c6f4',
    '213ce39f-3b13-4da2-919d-5ee2dcff7e69',
    '15d5f6f9-81af-46b7-a45a-bba14bfc16c9',
    '105799a4-a8e8-4a56-91a9-bf3f05a5e3b1',
    'e8b38d90-bd3f-40b9-ba1a-115855cb8aaf',
    '9b08d55d-0e97-42a6-9c51-89cbd67f0afa',
    '48f4efd9-778a-4db4-8366-451625f32eae',
    '84ee504e-0f8a-4443-ad00-f7883e285007',
    '1c7526e2-8cd2-4d0c-81b0-fb92f185d0e9',
    'c097fd0c-2551-4198-9c8d-0e104db8ccc3',
    '436e68d6-d7ca-4603-918e-8ccf879ddaf6',
    '096ac3c2-1b03-4b7c-a41e-963c377de4fe',
    'c7cf9e56-1572-47c2-be4f-577c9e24a72b',
    'c818f80d-afee-4ef5-b555-c97dd9dd8536',
    '45560961-094b-4015-9b66-d07f7343bf87',
    'e5411bfa-8905-489e-b7e9-e17aba0080ec',
    '3a17e3f9-9a20-4734-9da7-df5e72761839',
    '8e312f30-f18d-4fcd-84c8-a0d7b82459bf',
    'dab7edcf-f06f-4b87-b86b-e923638f272f',
    '91fcfbc6-65a2-41c8-89d1-434d32842124',
    'f22beaef-e781-4c7b-b040-ffbfa43addbd',
    '322c56cc-0513-4b72-9f7d-88aa14ca22ab',
    'b59af004-e7bd-4551-94e7-ed43627c9b98',
    '8ef48690-7ade-491e-9545-fb16b7529e46',
    '6f73b839-ec22-4620-916b-94ce871cf0a0',
    'db09fd2e-345e-40c5-a216-ba33b616af07',
    'd3f13f0e-91f5-4e61-8804-235be6e0af72',
    'fc76acbc-8aa8-46aa-b916-dc8ccc4bbfce',
    '03f1ebde-46d3-43ae-af92-eaeba562e94c',
    'b735c706-b88c-4823-a154-18f4f4ad57f9',
    '9557a824-bddb-4199-aac6-040005a29b43',
    '3464318e-9863-436c-96b6-32bfbc85327b',
    '0ad633fc-e073-4037-b195-965ee31d9d22',
    '22f9b004-e194-41b5-9d5a-380dce07ca32',
    '0fdee16d-e4f0-46ea-ac2e-6d32d0edf067',
    'ebf82c24-4ed2-497e-8c47-b684ba215378',
    '94fcbc39-3ab2-4a51-a697-98812b391aa0',
    'cb4e2f07-308a-4acf-a48e-398c9ce59439',
    'fa09b907-eac0-48bc-aa15-ff6331ece075',
    '0f70bc29-52fd-477a-a653-e38d9e41f4b0',
    '8c62ac64-80f2-4c80-b6af-12bcf48b3b39',
    '68d146ef-4856-4998-ac11-09eaaf1b3530',
    '1129ec58-07fb-4deb-8434-002a7a809c43',
    '4f46aaf1-b343-42c1-aea5-e16f0357017b',
    'a72bf0d7-3f58-4abc-89e1-7ff17c64d9ec',
    '077f143d-03cb-4e96-867c-a668255b4c34',
    '34b3ec96-5766-4d3c-be68-3f6d420eeb6c',
    '847aa630-41fc-48b9-b8b6-fe0faf2c0533',
    '46c184fd-53cf-4a39-816f-8d3022c67294',
    'da3467b3-1d0e-4ac6-9360-61dc6cf593f3',
    '40dac581-4416-43a5-8719-910d21f9f7a0',
    'd6293538-e0d1-4444-8c4f-104db5a1cde0',
    '1111207b-4bf0-444b-80d4-a807648b04ed',
    'fee5beb9-dbaf-4c70-9405-7a01eaed9b5d',
    '04d6c2f0-4e08-41aa-97fa-af957329c9c9',
    '79ff60ad-86f3-4441-946a-cca16521c9fe',
    'd0d04cd6-7b5b-4ae0-bbc2-866f6db9c865',
    'b21b0890-46d9-4112-9e45-502d966d1ba6',
    '1de318ed-e494-47ef-a961-15053f4a253a',
    'f1ae68a4-e0d4-46d9-9104-ec0a332d00d4',
    'db95aab0-1505-4f20-a6bd-f54e41a1d156',
    '18f799ab-6765-47ed-8aa9-09e877e22618',
    '06e11421-407a-469c-8d0d-cd80e590daf0',
    '13e4f9cc-5fd1-42d5-a07c-807be7022d20',
    '5922dd7b-0152-4181-bc5e-dd45022b81d8',
    'cceb8c15-2680-4cb7-ab34-3ea376938a6d',
    'b3e6ebd9-6cdc-438c-b3ab-2e0a2dad9776',
    '91c05ebe-949e-4460-bb87-ed683a52d953',
    'f110dd03-91ea-4a9f-9804-4a9323eb89c8',
    'a3fba40e-8925-40de-bf18-adee671c37a7',
    '99caaeb4-5997-49ed-af04-fe0475c50691',
    '7cb15ea8-1af4-4d39-baa9-f8c3638a7fe2',
    'f8d5f5e2-7957-4d4e-b080-942e5b0c27c5',
    'fb41b869-33ec-467b-a45b-3b51dae627a8',
    'c4679cf2-b087-4f56-8a77-e0757396a8c9',
    '9f380468-f31c-4edf-884a-0e8e59058226',
    '86745f98-49d0-440d-8c42-9f2ac2786279'
  ]::uuid[];
  category_ids uuid[] := ARRAY[
    '6aae32bd-8699-48d8-9be9-94aff734c17f',
    '599d13b9-f276-4fff-8cb3-2524a90e4254',
    '33888b90-5a67-4898-b32b-7def4ab516ad',
    '3165968c-6d47-4f54-af50-0af58f8aa481',
    '2cc5e05d-6d13-4d9d-a2c7-8ad234c0e20c',
    '8cf19213-c40a-4b28-a44c-9c4c8ae7c47a',
    '0685101d-35cf-4543-924d-7c533835a530',
    '6e848585-4464-45a2-a96a-2150da137823',
    '802db4d5-75d0-456f-a1f9-5070585ff49e',
    '4c23b423-9a1e-43ae-8bac-1d2c7ab745cb',
    '293ffa1b-c6bb-4555-ac6e-7108828a6ec3',
    '509db1fc-b8ff-4efc-9334-86bdcdbea696',
    'f18013bc-1ef6-419c-9453-e714fb1074e7',
    '75272f41-3ab1-4e81-9fce-fad30ca086cd',
    '2cfe663f-54db-4b96-945a-261c85b5a50d',
    '8fc8f3b1-1788-4174-857c-5a1597d79bdb',
    '123dfdd5-17d3-4dd9-9529-108fb9ed69ba',
    'a1633c1a-594c-4223-8c9e-60972049d177',
    '435151fa-19a8-4efa-a721-491be6bd27bb',
    'b4cde976-26cb-4abc-ac3a-9ce7ae778f11',
    '96f41622-de32-49d1-916b-23046791590e',
    '49c67981-8a7e-4e26-9ae7-df725cc9d742',
    '1772e3e3-d2d3-4337-b21f-fc415d0fa19a',
    '89204a74-5ffc-4d9d-805d-8eedeecd6d2d'
  ]::uuid[];
  protected_tables text[] := ARRAY['cart_items',
    'carts',
    'categories',
    'customer_addresses',
    'customer_repeat_requests',
    'customers',
    'delivery_assignments',
    'delivery_partner_profiles',
    'identity_usernames',
    'master_mapping_audit',
    'order_items',
    'order_status_history',
    'orders',
    'platform_management_events',
    'product_variants',
    'products',
    'store_operating_hours',
    'store_service_pincodes',
    'stores',
    'user_profiles'];
  table_name text;
  before_state jsonb := '{}'::jsonb;
  after_state jsonb := '{}'::jsonb;
  fingerprint jsonb;
  canonical_before text;
  canonical_after text;
  untouched_before text;
  untouched_after text;
  changed_products integer;
  changed_categories integer;
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'Unexpected database'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('master-catalog:serialized-writes:v1', 0));
  LOCK TABLE public.master_products, public.master_categories IN SHARE ROW EXCLUSIVE MODE;
  IF (SELECT count(*) FROM public.master_products WHERE id = ANY(product_ids)) <> 181
    OR (SELECT count(*) FROM public.master_categories WHERE id = ANY(category_ids)) <> 24 THEN
    RAISE EXCEPTION 'Approved catalog IDs missing; stop and repeat preflight';
  END IF;
  IF EXISTS (SELECT 1 FROM public.master_products WHERE id = ANY(product_ids)
    AND (created_at <> '2026-10-01T11:53:17.668526+00:00'::timestamptz
      OR (is_active AND updated_at <> created_at)))
    OR EXISTS (SELECT 1 FROM public.master_categories WHERE id = ANY(category_ids)
    AND (created_at <> '2026-10-01T11:53:17.668526+00:00'::timestamptz
      OR (is_active AND updated_at <> created_at))) THEN
    RAISE EXCEPTION 'An approved seeded record changed since preflight; stop for review';
  END IF;
  FOREACH table_name IN ARRAY protected_tables LOOP
    EXECUTE format('SELECT jsonb_build_object(''count'', count(*), ''md5'', md5(coalesce(string_agg(to_jsonb(t)::text, '','' ORDER BY to_jsonb(t)::text), ''''))) FROM public.%I t', table_name) INTO fingerprint;
    before_state := before_state || jsonb_build_object(table_name, fingerprint);
  END LOOP;
  SELECT md5(coalesce(string_agg(payload, ',' ORDER BY payload), '')) INTO canonical_before FROM (
    SELECT (to_jsonb(t) - 'is_active' - 'updated_at')::text AS payload FROM public.master_products t
    UNION ALL SELECT (to_jsonb(t) - 'is_active' - 'updated_at')::text FROM public.master_categories t
  ) x;
  SELECT md5(coalesce(string_agg(payload, ',' ORDER BY payload), '')) INTO untouched_before FROM (
    SELECT to_jsonb(t)::text AS payload FROM public.master_products t WHERE NOT(id = ANY(product_ids))
    UNION ALL SELECT to_jsonb(t)::text FROM public.master_categories t WHERE NOT(id = ANY(category_ids))
  ) x;
  UPDATE public.master_products SET is_active = false, updated_at = now() WHERE id = ANY(product_ids) AND is_active;
  GET DIAGNOSTICS changed_products = ROW_COUNT;
  UPDATE public.master_categories SET is_active = false, updated_at = now() WHERE id = ANY(category_ids) AND is_active;
  GET DIAGNOSTICS changed_categories = ROW_COUNT;
  FOREACH table_name IN ARRAY protected_tables LOOP
    EXECUTE format('SELECT jsonb_build_object(''count'', count(*), ''md5'', md5(coalesce(string_agg(to_jsonb(t)::text, '','' ORDER BY to_jsonb(t)::text), ''''))) FROM public.%I t', table_name) INTO fingerprint;
    after_state := after_state || jsonb_build_object(table_name, fingerprint);
  END LOOP;
  SELECT md5(coalesce(string_agg(payload, ',' ORDER BY payload), '')) INTO canonical_after FROM (
    SELECT (to_jsonb(t) - 'is_active' - 'updated_at')::text AS payload FROM public.master_products t
    UNION ALL SELECT (to_jsonb(t) - 'is_active' - 'updated_at')::text FROM public.master_categories t
  ) x;
  SELECT md5(coalesce(string_agg(payload, ',' ORDER BY payload), '')) INTO untouched_after FROM (
    SELECT to_jsonb(t)::text AS payload FROM public.master_products t WHERE NOT(id = ANY(product_ids))
    UNION ALL SELECT to_jsonb(t)::text FROM public.master_categories t WHERE NOT(id = ANY(category_ids))
  ) x;
  IF before_state IS DISTINCT FROM after_state OR canonical_before IS DISTINCT FROM canonical_after
    OR untouched_before IS DISTINCT FROM untouched_after THEN
    RAISE EXCEPTION 'Protected/catalog metadata fingerprint changed; rollback entire reset';
  END IF;
  RAISE NOTICE 'Archived % products and % categories; protected table and canonical metadata fingerprints unchanged', changed_products, changed_categories;
END;
$reset$;
COMMIT;
SELECT (SELECT count(*) FROM public.master_products WHERE is_active) active_products,
  (SELECT count(*) FROM public.master_categories WHERE is_active) active_categories,
  (SELECT count(*) FROM public.master_products) total_products,
  (SELECT count(*) FROM public.master_categories) total_categories;
