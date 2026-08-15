-- Phase 3, expand step: give opening hours a version, without changing behaviour.
--
-- The owner needs to enter the schedule that starts on 2026-09-01 now, without
-- overwriting the hours in force until 31 August. Bookings are taken up to twelve
-- months ahead, so a staged table promoted by a cron on the day would keep
-- offering August availability for September dates. The hours have to be
-- effective-dated and resolved per booking date instead.
--
-- This migration is deliberately ADDITIVE ONLY. A pull request is not a
-- deployment boundary: the migration and the application roll out separately, and
-- old instances keep running for a while. So nothing here may break the current
-- writer or the current readers.
--
-- In particular this does NOT:
--   * drop business_hours_day_of_week_key, which the existing
--     .upsert(..., { onConflict: 'day_of_week' }) requires. Both unique keys hold
--     while there is one version, which stays true until the contract step.
--   * add immutability triggers. The baseline is published, and the current
--     settings screen updates exactly those rows, so a trigger blocking writes to
--     published versions would break Business Hours the moment it landed. Those
--     rules arrive with the version-aware writer.
--   * make anything call the resolver. It exists so the next step can adopt it
--     one reader at a time.
--
-- After this runs, resolution is unchanged: one baseline version covering every
-- date, so business_hours_for_date returns exactly the row today's query returns.

-- Verified before commit by running this entire file inside a transaction against
-- production and rolling it back: every post-condition passed, the resolver
-- returned one row per date, and the 1096-date parity check found no
-- disagreement with the current query.

BEGIN;

-- ---------------------------------------------------------------------------
-- The version header
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_hours_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_from date NOT NULL,
  status        text NOT NULL CHECK (status IN ('draft', 'published', 'withdrawn')),
  label         text,
  is_baseline   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at  timestamptz,
  published_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.business_hours_versions IS
  'A dated set of weekly opening hours. Exactly seven business_hours rows belong to '
  'each version. Only published versions are visible to resolution, so a draft can '
  'be prepared without affecting bookings.';

COMMENT ON COLUMN public.business_hours_versions.is_baseline IS
  'The synthetic version created when versioning was introduced. It holds the '
  'schedule as it stood on migration day and is back-dated so every historical '
  'query still resolves. It is NOT a record of the hours actually worked before '
  'that date: business_hours had been overwritten in place for years. History is '
  'only trustworthy from the first version published after this migration.';

-- At most one published version per date. Drafts and withdrawn versions may share
-- a date with each other and with the published one.
CREATE UNIQUE INDEX IF NOT EXISTS business_hours_versions_published_date_key
  ON public.business_hours_versions (effective_from)
  WHERE status = 'published';

-- Exactly one baseline, ever.
CREATE UNIQUE INDEX IF NOT EXISTS business_hours_versions_single_baseline
  ON public.business_hours_versions ((true))
  WHERE is_baseline;

CREATE INDEX IF NOT EXISTS business_hours_versions_effective_from_idx
  ON public.business_hours_versions (effective_from DESC)
  WHERE status = 'published';

ALTER TABLE public.business_hours_versions ENABLE ROW LEVEL SECURITY;

-- Mirrors business_hours: publicly readable, because the website renders opening
-- hours. Writes go through the service role only, as they do today.
DROP POLICY IF EXISTS "Public can read business hours versions" ON public.business_hours_versions;
CREATE POLICY "Public can read business hours versions"
  ON public.business_hours_versions FOR SELECT USING (true);

GRANT SELECT ON public.business_hours_versions TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Attach the existing rows to a baseline version
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_baseline uuid;
  v_rows integer;
BEGIN
  SELECT id INTO v_baseline FROM public.business_hours_versions WHERE is_baseline;

  IF v_baseline IS NULL THEN
    INSERT INTO public.business_hours_versions (effective_from, status, label, is_baseline, published_at)
    VALUES (DATE '2000-01-01', 'published', 'Baseline (schedule as at 15 August 2026)', true, now())
    RETURNING id INTO v_baseline;
  END IF;

  ALTER TABLE public.business_hours ADD COLUMN IF NOT EXISTS version_id uuid;

  UPDATE public.business_hours SET version_id = v_baseline WHERE version_id IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RAISE NOTICE 'attached % business_hours rows to the baseline version', v_rows;

  -- A default so an INSERT from the current writer, which does not know about
  -- version_id, cannot fail on NOT NULL during the rollout. Removed in the
  -- contract step once the writer sets it explicitly.
  EXECUTE format(
    'ALTER TABLE public.business_hours ALTER COLUMN version_id SET DEFAULT %L::uuid', v_baseline);
END $$;

ALTER TABLE public.business_hours
  ALTER COLUMN version_id SET NOT NULL;

ALTER TABLE public.business_hours
  DROP CONSTRAINT IF EXISTS business_hours_version_id_fkey;
ALTER TABLE public.business_hours
  ADD CONSTRAINT business_hours_version_id_fkey
  FOREIGN KEY (version_id) REFERENCES public.business_hours_versions(id) ON DELETE CASCADE;

-- The new key. business_hours_day_of_week_key is deliberately LEFT IN PLACE: the
-- current writer's upsert needs it, and it holds while there is one version.
ALTER TABLE public.business_hours
  DROP CONSTRAINT IF EXISTS business_hours_version_day_key;
ALTER TABLE public.business_hours
  ADD CONSTRAINT business_hours_version_day_key UNIQUE (version_id, day_of_week);

-- ---------------------------------------------------------------------------
-- The resolver
--
-- Returns the weekly row that applies on a given date: the newest published
-- version whose effective_from has arrived. Returning SETOF business_hours means
-- every existing query keeps its shape, so adopting it is a FROM-clause swap:
--
--   FROM public.business_hours bh WHERE bh.day_of_week = EXTRACT(DOW FROM d)
--   becomes
--   FROM public.business_hours_for_date(d) bh
--
-- SECURITY INVOKER, not DEFINER. The tables it reads are already publicly
-- readable, so elevation buys nothing, and an unnecessary SECURITY DEFINER
-- function granted to anon was the actual hole found in the short-link audit.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_hours_for_date(p_date date)
RETURNS SETOF public.business_hours
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT bh.*
  FROM public.business_hours bh
  JOIN public.business_hours_versions v ON v.id = bh.version_id
  WHERE bh.day_of_week = EXTRACT(DOW FROM p_date)::integer
    AND v.status = 'published'
    AND v.effective_from <= p_date
  ORDER BY v.effective_from DESC
  LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.business_hours_for_date(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.business_hours_for_date(date) TO service_role, anon, authenticated;

COMMENT ON FUNCTION public.business_hours_for_date(date) IS
  'The weekly opening-hours row in force on a date. Only published versions count, '
  'so a draft has no effect. Every reader of business_hours should go through this '
  'rather than selecting on day_of_week, which picks arbitrarily once more than one '
  'version exists.';

-- ---------------------------------------------------------------------------
-- Post-conditions: prove nothing moved.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad integer;
BEGIN
  IF (SELECT count(*) FROM public.business_hours WHERE version_id IS NULL) > 0 THEN
    RAISE EXCEPTION 'business_hours rows left without a version';
  END IF;

  IF (SELECT count(*) FROM public.business_hours_versions) <> 1 THEN
    RAISE EXCEPTION 'expected exactly one version after expand';
  END IF;

  -- Every date in the next two years must resolve to the row today's query
  -- returns. With one baseline this is a tautology, which is the point: expand
  -- changes nothing, and this proves it rather than assuming it.
  SELECT count(*) INTO v_bad
  FROM generate_series(CURRENT_DATE - 365, CURRENT_DATE + 730, interval '1 day') d
  WHERE (SELECT bh.id FROM public.business_hours bh
          WHERE bh.day_of_week = EXTRACT(DOW FROM d::date)::integer LIMIT 1)
    IS DISTINCT FROM
        (SELECT r.id FROM public.business_hours_for_date(d::date) r);

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'resolver disagrees with the current query on % dates', v_bad;
  END IF;

  RAISE NOTICE 'expand complete: resolution unchanged across 1096 dates';
END $$;

COMMIT;
