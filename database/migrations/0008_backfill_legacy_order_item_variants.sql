-- Link legacy order lines to their neutral default variant without changing
-- any historical order-item snapshots or financial values.
-- The migration runner executes each migration transactionally; this explicit
-- table lock also fails safely if the script is ever run outside a transaction.
LOCK TABLE public.order_items IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
LOCK TABLE public.product_variants IN SHARE MODE;--> statement-breakpoint

DO $$
DECLARE
  invalid_legacy_line_count bigint;
BEGIN
  SELECT count(*)
  INTO invalid_legacy_line_count
  FROM public.order_items AS order_item
  LEFT JOIN LATERAL (
    SELECT count(*) AS matching_variant_count
    FROM public.product_variants AS variant
    WHERE variant.product_id = order_item.product_id
      AND variant.name = 'Standard'
      AND variant.quantity_value = 1
      AND variant.quantity_unit = 'pack'
  ) AS neutral_variants ON true
  WHERE order_item.variant_id IS NULL
    AND neutral_variants.matching_variant_count <> 1;

  IF invalid_legacy_line_count <> 0 THEN
    RAISE EXCEPTION
      'Cannot backfill legacy order items: % lines do not have exactly one Standard 1 pack variant',
      invalid_legacy_line_count;
  END IF;
END;
$$;--> statement-breakpoint

DROP TRIGGER order_items_identity_immutable ON public.order_items;--> statement-breakpoint
UPDATE public.order_items AS order_item
SET variant_id = variant.id
FROM public.product_variants AS variant
WHERE order_item.variant_id IS NULL
  AND variant.product_id = order_item.product_id
  AND variant.name = 'Standard'
  AND variant.quantity_value = 1
  AND variant.quantity_unit = 'pack';--> statement-breakpoint
CREATE TRIGGER order_items_identity_immutable
BEFORE UPDATE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.prevent_order_item_identity_changes();--> statement-breakpoint

DO $$
DECLARE
  remaining_legacy_line_count bigint;
BEGIN
  SELECT count(*)
  INTO remaining_legacy_line_count
  FROM public.order_items
  WHERE variant_id IS NULL;

  IF remaining_legacy_line_count <> 0 THEN
    RAISE EXCEPTION
      'Legacy order-item variant backfill incomplete: % NULL variant_id rows remain',
      remaining_legacy_line_count;
  END IF;

  RAISE NOTICE 'Legacy order-item variant backfill postcondition: % NULL variant_id rows remain',
    remaining_legacy_line_count;
END;
$$;--> statement-breakpoint