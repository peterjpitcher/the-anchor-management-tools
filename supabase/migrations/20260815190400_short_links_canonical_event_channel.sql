-- One canonical short link per event and channel.
--
-- short_links is unique on short_code and id only. Nothing stops two concurrent
-- callers each finding no link for an event and channel and creating one. That
-- has not happened, but the designer QR pack resolves up to 28 channels for every
-- event in a date range, so it multiplies the opportunity.
--
-- What is NOT a duplicate
-- -----------------------
-- Meta Ads creative variants. POST /api/marketing/meta-ads-link takes a variants
-- array, so one event and channel legitimately has many rows, each a different ad
-- creative with its own utm_content. Five events currently carry ten meta_ads rows
-- each for exactly this reason. A naive unique key on (event_id, channel) would
-- break that feature outright.
--
-- The discriminator is metadata.utm_variant, not parent_link_id. 460 canonical
-- promotion links have a non-null parent, so keying on parent_link_id IS NULL
-- would exclude most of the rows the guard is meant to protect. Filtering on
-- utm_variant leaves zero conflicts today, which is what makes this index
-- buildable.
--
-- The companion code change moves caller metadata to the front of the object
-- literal in getOrCreateShortLinkVariantInternal, so a caller can no longer
-- overwrite the utm_variant marker this index depends on.

BEGIN;

-- Refuse to build on data that would silently lose rows.
DO $$
DECLARE
  v_conflicts integer;
BEGIN
  SELECT count(*) INTO v_conflicts FROM (
    SELECT 1
    FROM public.short_links
    WHERE link_type = 'promotion'
      AND metadata ? 'event_id'
      AND metadata ? 'channel'
      AND COALESCE(metadata ->> 'utm_variant', '') <> 'true'
    GROUP BY metadata ->> 'event_id', metadata ->> 'channel'
    HAVING count(*) > 1
  ) x;

  IF v_conflicts > 0 THEN
    RAISE EXCEPTION
      'Cannot add the canonical short-link key: % event/channel pairs already have more than one non-variant link. Decide which one wins (prefer the oldest, it may already be in print) and retire the others by marking them as variants or repointing them.',
      v_conflicts;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS short_links_event_channel_canonical_key
  ON public.short_links ((metadata ->> 'event_id'), (metadata ->> 'channel'))
  WHERE link_type = 'promotion'
    AND metadata ? 'event_id'
    AND metadata ? 'channel'
    AND COALESCE(metadata ->> 'utm_variant', '') <> 'true';

COMMENT ON INDEX public.short_links_event_channel_canonical_key IS
  'One canonical promotion link per event and channel. Excludes Meta Ads creative '
  'variants, which are flagged metadata.utm_variant and legitimately many per pair. '
  'Partial, so PostgREST upsert cannot target it: use an explicit insert with '
  'ON CONFLICT inside a function.';

COMMIT;
