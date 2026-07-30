-- Voucher seed data: store plain text, not HTML entities.
--
-- The eight type definitions and the 21 terms clauses were lifted verbatim from
-- the design handoff, where every string is authored for direct injection into
-- HTML and therefore carries entities (&pound;, &amp;, &rsquo;, &eacute;).
-- That is correct for the printed card but wrong for storage: the management app
-- and the FOH page render these values as React text, so a manager saw
-- "&pound;10 FOOD VOUCHER" on the generate screen.
--
-- Fix at the data layer. Stored values become plain UTF-8 text and the print
-- template escapes them on the way back into HTML (see src/lib/voucher-card-template.ts).
-- entitlement_html stays genuine markup, so its structural entities (&amp;, &lt;,
-- &gt;) are preserved while the typographic ones are decoded.
--
-- Existing rows are repaired here, including voucher_batches.type_definitions,
-- because a batch generated before this migration holds an entity-laden snapshot
-- and reprints read the snapshot rather than the live type row.

BEGIN;

-- Temporary helper, dropped at the end of this migration so no new function is
-- left behind needing its own grants lockdown.
CREATE OR REPLACE FUNCTION pg_temp.voucher_decode_entities(p_value text, p_keep_structural boolean)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    ELSE
      CASE WHEN p_keep_structural THEN base ELSE replace(base, '&amp;', '&') END
  END
  FROM (
    SELECT replace(replace(replace(replace(replace(replace(replace(replace(
             p_value,
             '&pound;', '£'),
             '&rsquo;', '’'),
             '&lsquo;', '‘'),
             '&ldquo;', '“'),
             '&rdquo;', '”'),
             '&eacute;', 'é'),
             '&hellip;', '…'),
             '&middot;', '·') AS base
  ) AS decoded;
$fn$;

-- 1. Voucher types: titles and copy become plain text; entitlement_html keeps
--    its structural entities.
UPDATE public.voucher_types
SET display_title = pg_temp.voucher_decode_entities(display_title, false),
    cover_title = pg_temp.voucher_decode_entities(cover_title, false),
    entitlement_html = pg_temp.voucher_decode_entities(entitlement_html, true),
    hero = pg_temp.voucher_decode_entities(hero::text, false)::jsonb,
    copy = pg_temp.voucher_decode_entities(copy::text, false)::jsonb,
    updated_at = now();

-- 2. Terms clauses are prose rendered as text in the app and escaped by both
--    print templates.
UPDATE public.terms_versions
SET clauses = pg_temp.voucher_decode_entities(clauses::text, false)::jsonb;

-- 3. Batch snapshots taken before this migration. entitlement_html inside a
--    snapshot carries no structural entities in the seeded set, so a full decode
--    is a no-op for that field and correct for every other field.
UPDATE public.voucher_batches
SET type_definitions = pg_temp.voucher_decode_entities(type_definitions::text, false)::jsonb,
    updated_at = now();

-- Fail loudly if anything was missed, so this cannot half-apply silently.
DO $check$
DECLARE
  v_offenders integer;
BEGIN
  SELECT count(*) INTO v_offenders
  FROM public.voucher_types
  WHERE display_title LIKE '%&%;%'
     OR cover_title LIKE '%&%;%'
     OR hero::text LIKE '%&%;%'
     OR copy::text LIKE '%&%;%';
  IF v_offenders > 0 THEN
    RAISE EXCEPTION 'voucher_types still contains HTML entities in % row(s)', v_offenders;
  END IF;

  SELECT count(*) INTO v_offenders
  FROM public.terms_versions
  WHERE clauses::text LIKE '%&%;%';
  IF v_offenders > 0 THEN
    RAISE EXCEPTION 'terms_versions still contains HTML entities in % row(s)', v_offenders;
  END IF;
END
$check$;

DROP FUNCTION IF EXISTS pg_temp.voucher_decode_entities(text, boolean);

COMMIT;
