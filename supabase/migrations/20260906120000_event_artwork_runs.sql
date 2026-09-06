-- AI event artwork generation: schema, private bucket and grants.
-- Spec: docs/plans/2026-09-06-ai-event-artwork-generation-spec.md, section 7.
--
-- Purely additive. No existing table is altered, nothing is dropped, and no
-- existing function is replaced. In particular `event_images`, its image_type
-- CHECK, its partial unique index and the two variant RPCs from 20260812100000
-- are untouched (spec 7.7): publishing writes the five existing variants
-- through the existing action, so this migration is safe to apply ahead of any
-- code deploy and safe to roll code back under.
--
-- Access model. Every table here is service-role only. RLS is enabled with NO
-- policies, which denies anon and authenticated outright; the service role
-- bypasses RLS, and all writes go through server code that has already run a
-- permission check. Since 20260828120356 new objects in public no longer
-- inherit anon access, so there is nothing to undo, but each table also carries
-- an explicit REVOKE so a rebuilt database cannot depend on that default.
--
-- Coordinates are FRACTIONS of the image edge in the range 0 to 1, never
-- percentages, hence the `_frac` suffix on every one of them. An earlier
-- revision of the spec called them percentages while describing them as
-- fractions, which is the sort of mismatch that puts a logo off the canvas.

-- ---------------------------------------------------------------------------
-- 1. event_artwork_runs
--
-- One row per artwork session for an event. Holds the operator's placement
-- choices and the frozen copy the prompt was built from, so a run can be
-- explained after the fact without re-reading a since-edited event.
-- ---------------------------------------------------------------------------

create table if not exists public.event_artwork_runs (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references public.events (id) on delete cascade,
  status              text not null default 'draft'
                        check (status in ('draft', 'publishing', 'published', 'partially_published', 'discarded')),
  revision            int not null default 1,
  source_storage_path text,
  source_sha256       text,
  model               text not null,
  quality             text not null check (quality in ('low', 'medium', 'high')),
  poster_profile      text not null default 'standard' check (poster_profile in ('standard', 'high')),

  -- Null logo_corner means no logo at all, which is a legitimate choice, so the
  -- corner is nullable. The colour is only meaningful alongside a corner, and a
  -- corner without a colour would leave the compositor guessing, hence the
  -- table-level CHECK below rather than a plain NOT NULL on either column.
  logo_corner         text check (logo_corner in ('top_left', 'top_right', 'bottom_left', 'bottom_right')),
  logo_colour         text check (logo_colour in ('white', 'black')),

  -- 0.08 is the smallest logo that still reads at social sizes; 0.35 is the
  -- point at which the logo starts competing with the artwork itself.
  logo_width_frac     numeric not null default 0.22 check (logo_width_frac between 0.08 and 0.35),

  qr_centre_x_frac    numeric check (qr_centre_x_frac between 0 and 1),
  qr_centre_y_frac    numeric check (qr_centre_y_frac between 0 and 1),

  -- The 0.1905 floor is the smallest QR that still scans reliably from a poster
  -- at arm's length; it is derived in spec section 9.2, not guessed here.
  qr_width_frac       numeric check (qr_width_frac between 0.1905 and 0.40),

  short_link_id       uuid references public.short_links (id) on delete set null,
  event_copy_snapshot jsonb,
  prompt_version      text not null,

  -- Deliberately no FK to auth.users. Cron and webhook writes are attributed to
  -- SYSTEM_USER_ID, which defaults to the nil UUID and is not a real auth row,
  -- so an FK here would reject exactly the writes that must never fail.
  created_by          uuid,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  published_at        timestamptz,
  discarded_at        timestamptz,

  constraint event_artwork_runs_logo_colour_requires_corner
    check (logo_corner is null or logo_colour is not null)
);

comment on table public.event_artwork_runs is
  'One AI artwork session per event. Service-role only: holds unpublished draft work and cost data, and must never be reachable with the public browser key.';
comment on column public.event_artwork_runs.event_copy_snapshot is
  'The event copy frozen at the moment the prompt was built, so a run stays explainable after the event is edited.';
comment on column public.event_artwork_runs.qr_width_frac is
  'Fraction of the image edge, not a percentage. Floor of 0.1905 is the scannability limit from spec 9.2.';

-- One active run per event. `publishing` is in the predicate as well as `draft`
-- because without it a second draft could be created the instant a run moved to
-- publishing, and two runs would then race the same five variant slots. An
-- index covering only `draft` was a review finding for exactly that reason.
create unique index if not exists event_artwork_runs_one_active_per_event
  on public.event_artwork_runs (event_id)
  where status in ('draft', 'publishing');

-- Drives the cleanup cron, which sweeps abandoned drafts and stuck publishing
-- runs by age.
create index if not exists event_artwork_runs_status_updated_at_idx
  on public.event_artwork_runs (status, updated_at);

-- ---------------------------------------------------------------------------
-- 2. event_artwork_variants
--
-- One row per run per output size. The claim token and lease are what stop two
-- workers generating the same variant at once; the lease expiring is what stops
-- a crashed worker holding it forever.
-- ---------------------------------------------------------------------------

create table if not exists public.event_artwork_variants (
  id                      uuid primary key default gen_random_uuid(),
  run_id                  uuid not null references public.event_artwork_runs (id) on delete cascade,

  -- Deliberately the same five names as event_images.image_type. This migration
  -- adds no new value there and changes no constraint on that table (spec 7.7);
  -- publishing writes through the existing upsert_event_image_variant RPC.
  variant                 text not null
                            check (variant in ('square', 'landscape', 'social', 'story', 'print_poster')),

  status                  text not null default 'pending'
                            check (status in ('pending', 'generating', 'ready', 'failed')),

  -- FK to event_artwork_attempts is added in section 4, once that table exists.
  current_attempt_id      uuid,

  approved_placement_hash text,
  composite_path          text,
  claim_token             uuid,
  lease_expires_at        timestamptz,

  -- Hard ceiling on retries per variant. The budget check is the primary guard,
  -- but a runaway retry loop would burn money before the daily cap noticed.
  attempt_count           int not null default 0 check (attempt_count between 0 and 6),

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint event_artwork_variants_run_variant_uniq unique (run_id, variant)
);

comment on table public.event_artwork_variants is
  'One output size per artwork run. claim_token plus lease_expires_at give a single worker exclusive use of a variant without a distributed lock.';

-- ---------------------------------------------------------------------------
-- 3. event_artwork_attempts
--
-- Append-only. A row is inserted when a provider call starts and updated only
-- to record its terminal outcome. `outcome` is null while a call is in flight,
-- which is what makes an uncertain result distinguishable from a failed one:
-- an abandoned request may still have been billed.
-- ---------------------------------------------------------------------------

create table if not exists public.event_artwork_attempts (
  id                  uuid primary key default gen_random_uuid(),
  variant_id          uuid not null references public.event_artwork_variants (id) on delete cascade,
  attempt_no          int not null,
  claim_token         uuid not null,

  outcome             text check (outcome in ('succeeded', 'failed', 'uncertain', 'abandoned')),

  storage_path        text,
  requested_size      text not null,
  provider_request_id text,

  input_text_tokens   int,
  input_image_tokens  int,
  output_image_tokens int,
  cost_usd            numeric,

  -- `calculated` means the provider returned usage we priced exactly.
  -- `estimated` means we priced it from the request. `unknown` means the call
  -- may have been billed and we cannot say how much, which is the case the
  -- budget reconciliation has to treat as spend.
  cost_basis          text check (cost_basis in ('calculated', 'estimated', 'unknown')),
  rate_version        text,

  error_code          text,
  error_detail        text,

  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),

  constraint event_artwork_attempts_variant_attempt_uniq unique (variant_id, attempt_no)
);

comment on table public.event_artwork_attempts is
  'Append-only provider call log per variant. Never updated except to set a terminal outcome. A null outcome means in flight, not successful.';

-- No separate index on (variant_id, attempt_no): the UNIQUE constraint above
-- already provides one, and a duplicate would only cost write time.

-- ---------------------------------------------------------------------------
-- 4. Close the loop between variants and attempts
--
-- Added here rather than inline because the two tables reference each other.
-- ON DELETE SET NULL, not CASCADE: losing an attempt row must never take the
-- variant with it.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'event_artwork_variants_current_attempt_fk'
      and conrelid = 'public.event_artwork_variants'::regclass
  ) then
    alter table public.event_artwork_variants
      add constraint event_artwork_variants_current_attempt_fk
      foreign key (current_attempt_id)
      references public.event_artwork_attempts (id)
      on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. event_artwork_publications
--
-- One row per variant per publish attempt. `expected_previous_url` is captured
-- when the manifest freezes and compared with the live events cache column
-- before anything is replaced. A mismatch means someone uploaded manually in
-- the meantime, so the variant is recorded as skipped_conflict and is NOT
-- overwritten. This is the compare-before-replace from spec 6.4, and it is the
-- reason publication is a durable row rather than an in-memory step.
-- ---------------------------------------------------------------------------

create table if not exists public.event_artwork_publications (
  id                    uuid primary key default gen_random_uuid(),
  run_id                uuid not null references public.event_artwork_runs (id) on delete cascade,
  -- Same five names as event_artwork_variants and event_images.image_type. A
  -- publication row naming a variant that cannot exist is always a bug, and
  -- catching it here is cheaper than discovering it when a publish silently
  -- writes nothing.
  variant               text not null
                          check (variant in ('square', 'landscape', 'social', 'story', 'print_poster')),
  expected_previous_url text,
  published_url         text,
  outcome               text not null default 'pending'
                          check (outcome in ('pending', 'published', 'skipped_conflict', 'failed')),
  error                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.event_artwork_publications is
  'Per variant, per publish attempt. Deliberately not unique on (run_id, variant): a retry of an unresolved variant records a new row so the history of conflicts and failures survives.';

create index if not exists event_artwork_publications_run_idx
  on public.event_artwork_publications (run_id);

-- ---------------------------------------------------------------------------
-- 6. event_artwork_spend
--
-- One row per reservation, not a report. Money is reserved before every paid
-- call and reconciled after, so the sum over a scope and day is the enforcement
-- point for the budget cap.
-- ---------------------------------------------------------------------------

create table if not exists public.event_artwork_spend (
  id           uuid primary key default gen_random_uuid(),
  scope        text not null check (scope in ('run', 'event', 'global')),

  -- The run id, the event id, or a fixed key for the global scope. Kept as text
  -- because the three scopes do not share a key type.
  scope_key    text not null,

  day          date not null,
  reserved_usd numeric not null default 0,
  actual_usd   numeric,

  -- Deliberately no FK to event_artwork_attempts. Deleting an event cascades to
  -- runs, variants and attempts, and the spend record has to outlive that: what
  -- was billed happened whether or not the event still exists.
  attempt_id   uuid,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.event_artwork_spend is
  'Budget reservations and reconciliations. Summed by (scope, scope_key, day) on the hot path before every paid provider call, so the index below is load-bearing, not reporting sugar.';

create index if not exists event_artwork_spend_scope_day_idx
  on public.event_artwork_spend (scope, scope_key, day)
  include (reserved_usd, actual_usd);

-- ---------------------------------------------------------------------------
-- 7. event_artwork_tombstones
--
-- Deleting an event cascades through runs, variants and attempts and takes
-- every storage path with it, which would leave the objects in the bucket with
-- nothing left in the database that knows they exist. A tombstone is written
-- when a run starts and carries the storage prefix, so cleanup can still find
-- the files afterwards.
--
-- There is deliberately NO foreign key on event_id or run_id. An FK is exactly
-- what would cascade this row away with everything else, which defeats the only
-- reason the table exists.
-- ---------------------------------------------------------------------------

create table if not exists public.event_artwork_tombstones (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null,
  event_id       uuid not null,
  storage_prefix text not null,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

comment on table public.event_artwork_tombstones is
  'Storage prefixes that outlive their run. No FK to events or event_artwork_runs on purpose: the row must survive the cascade that removes them, otherwise deleting an event orphans its artwork objects forever.';

create index if not exists event_artwork_tombstones_pending_idx
  on public.event_artwork_tombstones (created_at)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 8. updated_at maintenance
--
-- Reuses the existing convention, public.update_updated_at_column(). Attempts
-- and tombstones have no updated_at: both are append-only by design.
-- ---------------------------------------------------------------------------

drop trigger if exists event_artwork_runs_set_updated_at on public.event_artwork_runs;
create trigger event_artwork_runs_set_updated_at
  before update on public.event_artwork_runs
  for each row execute function public.update_updated_at_column();

drop trigger if exists event_artwork_variants_set_updated_at on public.event_artwork_variants;
create trigger event_artwork_variants_set_updated_at
  before update on public.event_artwork_variants
  for each row execute function public.update_updated_at_column();

drop trigger if exists event_artwork_publications_set_updated_at on public.event_artwork_publications;
create trigger event_artwork_publications_set_updated_at
  before update on public.event_artwork_publications
  for each row execute function public.update_updated_at_column();

drop trigger if exists event_artwork_spend_set_updated_at on public.event_artwork_spend;
create trigger event_artwork_spend_set_updated_at
  before update on public.event_artwork_spend
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 9. RLS and grants
--
-- RLS on with no policies is a deny-all for anon and authenticated. The service
-- role bypasses RLS entirely, which is the only path these tables are written
-- through, and always after a checkUserPermission() call in server code.
--
-- These tables hold unpublished artwork paths, provider request ids and spend
-- in real money. None of it may ever reach the public browser key, so anon and
-- authenticated are revoked explicitly rather than relying on the default
-- privileges fix from 20260828120356 still being in place.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'event_artwork_runs',
    'event_artwork_variants',
    'event_artwork_attempts',
    'event_artwork_publications',
    'event_artwork_spend',
    'event_artwork_tombstones'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('revoke all on table public.%I from public, anon, authenticated;', t);
    execute format('grant all on table public.%I to service_role;', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Private bucket: event-artwork-drafts
--
-- Objects live at events/{eventId}/runs/{runId}/... . The browser never reads
-- the bucket directly; it receives 300 second signed URLs from an endpoint that
-- checks the caller's permission AND that the path belongs to the run and event
-- they asked for. Paths are always built server-side from ids.
--
-- 25 MB and PNG or JPEG only. A generated poster at the high profile sits well
-- under that; anything larger is a bug, not a bigger picture.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-artwork-drafts', 'event-artwork-drafts', false, 26214400, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- ON CONFLICT DO NOTHING means a pre-existing row with the wrong settings would
-- pass silently, and a bucket that is accidentally public is the whole risk
-- here. Assert what actually landed.
do $$
declare
  v_public boolean;
  v_limit  bigint;
  v_mimes  text[];
begin
  select b.public, b.file_size_limit, b.allowed_mime_types
    into v_public, v_limit, v_mimes
  from storage.buckets b
  where b.id = 'event-artwork-drafts';

  if not found then
    raise exception 'event-artwork-drafts bucket was not created';
  end if;
  if v_public is distinct from false then
    raise exception 'event-artwork-drafts bucket is public. It holds unpublished artwork and must not be.';
  end if;
  if v_limit is distinct from 26214400 then
    raise exception 'event-artwork-drafts file_size_limit is %, expected 26214400', v_limit;
  end if;
  if v_mimes is distinct from array['image/png', 'image/jpeg'] then
    raise exception 'event-artwork-drafts allowed_mime_types is %, expected {image/png,image/jpeg}', v_mimes;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 11. Deny anon and authenticated on the bucket's objects
--
-- storage.objects already denies by default: RLS is on and every existing
-- permissive policy for public, anon or authenticated is scoped to a named
-- bucket, verified in section 12. The restrictive policy below is belt and
-- braces, so that a future permissive policy written without a bucket_id filter
-- cannot quietly open this bucket too. It is scoped to a single bucket, so it
-- ANDs to true for every other bucket and changes nothing that works today.
-- The service role bypasses RLS and is unaffected.
--
-- storage.objects is owned by supabase_storage_admin, and postgres is not a
-- member of that role in this project, so the CREATE may not be permitted. Only
-- insufficient_privilege is tolerated, and only because section 12 proves the
-- deny-all independently. Anything else is a real fault and aborts.
-- ---------------------------------------------------------------------------

do $$
begin
  begin
    drop policy if exists event_artwork_drafts_deny_anon_and_authenticated on storage.objects;

    create policy event_artwork_drafts_deny_anon_and_authenticated
      on storage.objects
      as restrictive
      for all
      to anon, authenticated
      using (bucket_id <> 'event-artwork-drafts')
      with check (bucket_id <> 'event-artwork-drafts');
  exception when insufficient_privilege then
    raise warning
      'Could not add the restrictive storage policy: postgres does not own storage.objects. The bucket is still deny-all, proven by the next check.';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 12. Prove the bucket is unreachable with the public key, or fail
-- ---------------------------------------------------------------------------

do $$
declare
  v_unscoped int;
  v_named    int;
begin
  -- A permissive policy for public, anon or authenticated with no bucket_id
  -- predicate applies to every bucket, including this one.
  select count(*) into v_unscoped
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and permissive = 'PERMISSIVE'
    and (roles::text like '%public%' or 'anon' = any(roles) or 'authenticated' = any(roles))
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) not like '%bucket_id%';

  -- Or one that names this bucket outright.
  select count(*) into v_named
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and permissive = 'PERMISSIVE'
    and (roles::text like '%public%' or 'anon' = any(roles) or 'authenticated' = any(roles))
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%event-artwork-drafts%';

  if v_unscoped > 0 then
    raise exception
      '% permissive storage.objects policies for public, anon or authenticated have no bucket_id filter, so event-artwork-drafts is reachable with the browser key', v_unscoped;
  end if;
  if v_named > 0 then
    raise exception
      '% permissive storage.objects policies grant public, anon or authenticated access to event-artwork-drafts', v_named;
  end if;

  raise notice 'event-artwork-drafts verified: private bucket, no permissive policy reaches it';
end $$;
