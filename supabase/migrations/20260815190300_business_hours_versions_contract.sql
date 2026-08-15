-- Phase 3, contract step: remove the scaffolding that kept the old writer alive.
--
-- Safe only now that the version-aware writer and all readers are deployed and
-- verified in production. Until this runs, a second version of the weekly hours
-- cannot exist, because business_hours_day_of_week_key allows one row per weekday.
--
-- Deliberately does NOT add the published-version immutability triggers. The
-- settings screen still edits the active version in place, which is published, so
-- a trigger blocking that would break Business Hours exactly as it would have in
-- the expand step. Immutability arrives with the version UI, which is what makes
-- "a correction creates a new version" true rather than aspirational.

BEGIN;

-- 1. One row per weekday, per version. The blanket weekday key goes.
ALTER TABLE public.business_hours
  DROP CONSTRAINT IF EXISTS business_hours_day_of_week_key;

-- 2. The transitional default existed so the old writer, which knew nothing about
--    version_id, could not hit NOT NULL mid rollout. The new writer sets it
--    explicitly, so remove the default: an insert that forgets it should now fail
--    loudly rather than land silently in the baseline.
ALTER TABLE public.business_hours
  ALTER COLUMN version_id DROP DEFAULT;

-- 3. Publishing a version is one transactional operation that refuses to publish
--    an incomplete week. A six-day version would otherwise resolve as a mix of
--    two versions, which is the failure this whole design exists to prevent.
CREATE OR REPLACE FUNCTION public.publish_business_hours_version(
  p_version_id uuid,
  p_actor uuid DEFAULT NULL
)
RETURNS public.business_hours_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_version public.business_hours_versions;
  v_days integer;
  v_missing text;
BEGIN
  SELECT * INTO v_version
    FROM public.business_hours_versions
   WHERE id = p_version_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opening-hours version % does not exist', p_version_id
      USING ERRCODE = '22023';
  END IF;

  IF v_version.status = 'published' THEN
    -- Idempotent: two clicks, or two tabs, publish once.
    RETURN v_version;
  END IF;

  IF v_version.status = 'withdrawn' THEN
    RAISE EXCEPTION 'That version was withdrawn. Create a new one rather than republishing it.'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT day_of_week) INTO v_days
    FROM public.business_hours WHERE version_id = p_version_id;

  IF v_days <> 7 THEN
    SELECT string_agg(d::text, ', ' ORDER BY d) INTO v_missing
      FROM generate_series(0, 6) d
     WHERE NOT EXISTS (
       SELECT 1 FROM public.business_hours bh
        WHERE bh.version_id = p_version_id AND bh.day_of_week = d);
    RAISE EXCEPTION
      'This schedule is missing % of the seven days (day_of_week %). Every day must be set before it can be published.',
      7 - v_days, v_missing
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.business_hours_versions
     SET status = 'published', published_at = now(), published_by = p_actor
   WHERE id = p_version_id
  RETURNING * INTO v_version;

  RETURN v_version;
END;
$function$;

REVOKE ALL ON FUNCTION public.publish_business_hours_version(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_business_hours_version(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.publish_business_hours_version(uuid, uuid) IS
  'Publish a draft schedule, atomically and only if it covers all seven weekdays. '
  'Idempotent: publishing an already-published version returns it unchanged.';

-- 4. The baseline must never be deleted: it is what makes every historical date
--    resolve. A cascade from the header would take its seven rows with it.
CREATE OR REPLACE FUNCTION public.protect_baseline_hours_version()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.is_baseline THEN
    RAISE EXCEPTION 'The baseline opening-hours version cannot be deleted. Every date before the first scheduled change resolves through it.'
      USING ERRCODE = '22023';
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS business_hours_versions_protect_baseline ON public.business_hours_versions;
CREATE TRIGGER business_hours_versions_protect_baseline
  BEFORE DELETE ON public.business_hours_versions
  FOR EACH ROW EXECUTE FUNCTION public.protect_baseline_hours_version();

-- 5. A version whose date has passed can no longer be withdrawn: bookings were
--    accepted against it, so removing it would rewrite what those bookings were
--    checked against. Evaluated in London inside the database, not in the caller,
--    so a direct RPC cannot bypass it.
CREATE OR REPLACE FUNCTION public.guard_hours_version_withdrawal()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'withdrawn' AND OLD.status <> 'withdrawn' THEN
    IF OLD.is_baseline THEN
      RAISE EXCEPTION 'The baseline opening-hours version cannot be withdrawn.'
        USING ERRCODE = '22023';
    END IF;
    IF OLD.effective_from <= (now() AT TIME ZONE 'Europe/London')::date THEN
      RAISE EXCEPTION
        'That schedule took effect on % and cannot be withdrawn. Publish a new version instead.',
        to_char(OLD.effective_from, 'DD Mon YYYY')
        USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS business_hours_versions_guard_withdrawal ON public.business_hours_versions;
CREATE TRIGGER business_hours_versions_guard_withdrawal
  BEFORE UPDATE ON public.business_hours_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_hours_version_withdrawal();

-- Post-conditions
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
              WHERE t.relname = 'business_hours' AND c.conname = 'business_hours_day_of_week_key') THEN
    RAISE EXCEPTION 'the weekday-only unique key is still present';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                  WHERE t.relname = 'business_hours' AND c.conname = 'business_hours_version_day_key') THEN
    RAISE EXCEPTION 'the (version_id, day_of_week) key is missing, refusing to leave the table unprotected';
  END IF;

  IF (SELECT count(*) FROM public.business_hours WHERE version_id IS NULL) > 0 THEN
    RAISE EXCEPTION 'rows without a version';
  END IF;
END $$;

COMMIT;
