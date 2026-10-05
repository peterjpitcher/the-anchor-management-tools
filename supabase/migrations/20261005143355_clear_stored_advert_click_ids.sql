-- Clear the advert click ids already stored against event bookings.
--
-- Until 5 October 2026 the event bookings API kept the visitor's fbclid on the
-- `event_booking_created` analytics event, and the page address it stored there (source_url)
-- carried fbclid in its query string. The same address was stored as consent evidence on
-- customer_consents. A click id identifies one person's click on one advert. Owner decision,
-- 5 October 2026: none is kept against a booking, so the ones already stored are cleared.
--
-- What changes (counts on production, 5 October 2026):
--   analytics_events where event_type = 'event_booking_created': 17 rows of 201
--     - the fbclid key is removed from metadata and from metadata.attribution
--     - click id parameters are removed from metadata.source_url and
--       metadata.attribution.source_url
--   customer_consents: 10 rows of the 53 that have a source_url
--     - click id parameters are removed from source_url
--
-- Nothing else in any row changes and no row is deleted. Campaign tags (utm_*), short_code and
-- the rest of each address stay. The updated_at trigger on customer_consents moves updated_at on
-- those 10 rows; captured_at and event_sequence, which decide which consent is current, are
-- untouched.
--
-- Not reversible, by design: the point is that the click ids are gone.
-- Safe to run twice: a second run finds nothing to change.
-- Run it only once the code that stops writing click ids is live, or new ones can arrive after it.

-- The same list as CLICK_ID_PARAMS in src/lib/api/attribution-labels.ts. Session-only helpers:
-- they live in pg_temp, are dropped at the end, and leave no object behind.
CREATE FUNCTION pg_temp.strip_click_ids(url text) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT regexp_replace(
    regexp_replace(
      -- every click id that follows another parameter
      regexp_replace(url, '&(fbclid|gclid|gbraid|wbraid|dclid|msclkid|ttclid|twclid)=[^&#]*', '', 'gi'),
      -- a click id that is the first parameter, with others after it
      '\?(fbclid|gclid|gbraid|wbraid|dclid|msclkid|ttclid|twclid)=[^&#]*&', '?', 'i'),
    -- a click id that is the only parameter
    '\?(fbclid|gclid|gbraid|wbraid|dclid|msclkid|ttclid|twclid)=[^&#]*', '', 'i')
$$;

-- One level of the metadata: the fbclid key goes, and source_url loses its click ids.
CREATE FUNCTION pg_temp.without_click_ids(obj jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(obj) IS DISTINCT FROM 'object' THEN obj
    WHEN jsonb_typeof(obj->'source_url') = 'string' THEN
      jsonb_set(obj, '{source_url}', to_jsonb(pg_temp.strip_click_ids(obj->>'source_url'))) - 'fbclid'
    ELSE obj - 'fbclid'
  END
$$;

-- True when a metadata level still holds a click id, as its own key or inside source_url.
CREATE FUNCTION pg_temp.holds_click_id(obj jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT COALESCE(
    obj->>'fbclid' IS NOT NULL
    OR pg_temp.strip_click_ids(obj->>'source_url') IS DISTINCT FROM obj->>'source_url',
    false)
$$;

UPDATE public.analytics_events e
SET metadata = COALESCE(
  CASE
    -- jsonb_set returns NULL when handed a NULL value, so only nest when there is an object.
    WHEN jsonb_typeof(e.metadata->'attribution') = 'object' THEN
      jsonb_set(
        pg_temp.without_click_ids(e.metadata),
        '{attribution}',
        pg_temp.without_click_ids(e.metadata->'attribution'))
    ELSE pg_temp.without_click_ids(e.metadata)
  END,
  -- Never write a NULL over a row. If the cleaning ever produced one, the row is left as it
  -- was and the check below stops the migration.
  e.metadata)
WHERE e.event_type = 'event_booking_created'
  AND jsonb_typeof(e.metadata) = 'object'
  AND (pg_temp.holds_click_id(e.metadata) OR pg_temp.holds_click_id(e.metadata->'attribution'));

UPDATE public.customer_consents c
SET source_url = pg_temp.strip_click_ids(c.source_url)
WHERE pg_temp.strip_click_ids(c.source_url) IS DISTINCT FROM c.source_url;

-- Fail closed: if anything is left, raise, which rolls the whole migration back.
DO $$
DECLARE
  analytics_left integer;
  consents_left integer;
BEGIN
  SELECT count(*) INTO analytics_left
  FROM public.analytics_events e
  WHERE e.event_type = 'event_booking_created'
    AND (pg_temp.holds_click_id(e.metadata) OR pg_temp.holds_click_id(e.metadata->'attribution'));

  SELECT count(*) INTO consents_left
  FROM public.customer_consents c
  WHERE pg_temp.strip_click_ids(c.source_url) IS DISTINCT FROM c.source_url;

  IF analytics_left > 0 OR consents_left > 0 THEN
    RAISE EXCEPTION 'Click ids remain: % analytics rows, % consent rows', analytics_left, consents_left;
  END IF;
END
$$;

DROP FUNCTION pg_temp.holds_click_id(jsonb);
DROP FUNCTION pg_temp.without_click_ids(jsonb);
DROP FUNCTION pg_temp.strip_click_ids(text);
