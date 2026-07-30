-- Every voucher type now carries a cash value (owner, 2026-07-30).
--
-- The design handoff left the five entitlement types without a value, so the
-- outstanding-liability figure only counted the four money vouchers. The owner
-- has set a value for all of them, so "outstanding value" now reflects the whole
-- liability:
--   free drink            £6
--   bottle of house wine  £20
--   Sunday roast for two  £40
--   four quiz tickets     £12
--   four music bingo      £20
--
-- Values are not printed on the entitlement cards, so no artwork changes and no
-- reprint is needed. Existing vouchers are backfilled because value_pence is a
-- generation-time snapshot: without this, cards already in the drawer would
-- report no value for the rest of their life.

BEGIN;

UPDATE public.voucher_types SET value_pence = 600, updated_at = now() WHERE id = 'free-drink';
UPDATE public.voucher_types SET value_pence = 2000, updated_at = now() WHERE id = 'house-wine';
UPDATE public.voucher_types SET value_pence = 4000, updated_at = now() WHERE id = 'roast-two';
UPDATE public.voucher_types SET value_pence = 1200, updated_at = now() WHERE id = 'quiz-four';
UPDATE public.voucher_types SET value_pence = 2000, updated_at = now() WHERE id = 'bingo-four';

-- Batch snapshots drive reprints and the FOH result card, so they follow.
UPDATE public.voucher_batches b
SET type_definitions = (
      SELECT jsonb_object_agg(
               key,
               CASE
                 WHEN t.value_pence IS NULL THEN value
                 ELSE jsonb_set(value, '{value_pence}', to_jsonb(t.value_pence), true)
               END
             )
      FROM jsonb_each(b.type_definitions) AS snapshot(key, value)
      LEFT JOIN public.voucher_types t ON t.id = snapshot.key
    ),
    updated_at = now()
WHERE b.type_definitions IS NOT NULL;

-- Vouchers already generated keep their own snapshot of the value.
UPDATE public.vouchers v
SET value_pence = t.value_pence,
    updated_at = now()
FROM public.voucher_types t
WHERE t.id = v.type_id
  AND v.value_pence IS DISTINCT FROM t.value_pence
  AND v.value_pence IS NULL;

-- Fail loudly rather than half-applying.
DO $check$
DECLARE
  v_missing integer;
BEGIN
  SELECT count(*) INTO v_missing FROM public.voucher_types WHERE value_pence IS NULL;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'voucher_types still has % type(s) without a value', v_missing;
  END IF;

  SELECT count(*) INTO v_missing FROM public.vouchers WHERE value_pence IS NULL;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'vouchers still has % row(s) without a value', v_missing;
  END IF;

  SELECT count(*) INTO v_missing
  FROM public.voucher_batches b, jsonb_each(b.type_definitions) AS snapshot(key, value)
  WHERE value ->> 'value_pence' IS NULL;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'batch snapshots still have % type entr(ies) without a value', v_missing;
  END IF;
END
$check$;

COMMIT;
