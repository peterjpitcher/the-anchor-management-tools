-- Event image variants: add the table talker.
--
-- A sixth singleton variant, `table_talker`: one slim DL panel (99 x 210 mm)
-- that AMS tiles three to an A4 landscape sheet for printing. Print only, never
-- emitted by the public API.
--
-- Purely additive. Every value the deployed code can write today is still
-- accepted, so this is safe to apply ahead of the code, and it MUST be applied
-- ahead of the code: the new code selects events.table_talker_url on every
-- artwork path, and PostgREST answers a missing column with a 400.
--
-- Three things in the database name the variants one by one, and all three
-- would silently exclude a new variant if left alone:
--   1. the CHECK on event_images.image_type;
--   2. the partial unique index that keeps one row per event per variant;
--   3. the allow list and cache column chain inside both variant RPCs.
-- The assertion block at the end refuses to finish unless all three include
-- the table talker.
--
-- The RPC bodies below are the production definitions verbatim (checked with
-- pg_get_functiondef on 2026-09-10) with one variant added. Nothing else in
-- them changes.

set lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1. Allow the new variant
-- ---------------------------------------------------------------------------

alter table public.event_images
  drop constraint if exists event_images_image_type_check;

alter table public.event_images
  add constraint event_images_image_type_check
  check (image_type in (
    -- current vocabulary
    'square', 'landscape', 'social', 'story', 'print_poster', 'table_talker',
    -- multi-row type, unchanged
    'gallery',
    -- legacy, retained for rollback safety until the cleanup migration
    'hero', 'thumbnail', 'poster'
  ));

-- ---------------------------------------------------------------------------
-- 2. Cache column on events
-- ---------------------------------------------------------------------------

alter table public.events
  add column if not exists table_talker_url text;

comment on column public.events.table_talker_url is
  'Slim DL table talker artwork, tiled three to an A4 sheet for print. Never emitted by the public API';

-- ---------------------------------------------------------------------------
-- 3. One row per event per singleton variant, now including the table talker
--
-- The predicate is part of the index definition, so it has to be rebuilt to
-- widen. The table holds about a hundred rows, so the rebuild is instant, and
-- there are no table talker rows yet, so the new index cannot fail to build.
-- ---------------------------------------------------------------------------

drop index if exists public.event_images_singleton_variant_uniq;

create unique index event_images_singleton_variant_uniq
  on public.event_images (event_id, image_type)
  where image_type in ('square', 'landscape', 'social', 'story', 'print_poster', 'table_talker');

-- ---------------------------------------------------------------------------
-- 4. The two variant RPCs
-- ---------------------------------------------------------------------------

create or replace function public.upsert_event_image_variant(
  p_event_id        uuid,
  p_variant         text,
  p_storage_path    text,
  p_public_url      text,
  p_file_name       text,
  p_mime_type       text,
  p_file_size_bytes integer,
  p_uploaded_by     uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous_path text;
  v_existing_id   uuid;
begin
  if p_variant not in ('square', 'landscape', 'social', 'story', 'print_poster', 'table_talker') then
    raise exception 'Unknown event image variant: %', p_variant;
  end if;

  -- Serialises two editors racing the same variant.
  perform 1 from events where id = p_event_id for update;
  if not found then
    raise exception 'Event % not found', p_event_id;
  end if;

  select id, storage_path into v_existing_id, v_previous_path
  from event_images
  where event_id = p_event_id and image_type = p_variant;

  if v_existing_id is null then
    insert into event_images (
      event_id, image_type, storage_path, file_name,
      mime_type, file_size_bytes, uploaded_by, display_order
    )
    values (
      p_event_id, p_variant, p_storage_path, p_file_name,
      p_mime_type, p_file_size_bytes, p_uploaded_by, 0
    );
  else
    update event_images
    set storage_path    = p_storage_path,
        file_name       = p_file_name,
        mime_type       = p_mime_type,
        file_size_bytes = p_file_size_bytes,
        uploaded_by     = p_uploaded_by,
        updated_at      = now()
    where id = v_existing_id;
  end if;

  -- The square still populates all three legacy columns, so the public API and
  -- the website see exactly what they see today.
  if p_variant = 'square' then
    update events
    set hero_image_url      = p_public_url,
        thumbnail_image_url = p_public_url,
        poster_image_url    = p_public_url
    where id = p_event_id;
  elsif p_variant = 'landscape' then
    update events set landscape_image_url = p_public_url where id = p_event_id;
  elsif p_variant = 'social' then
    update events set social_image_url = p_public_url where id = p_event_id;
  elsif p_variant = 'story' then
    update events set story_image_url = p_public_url where id = p_event_id;
  elsif p_variant = 'print_poster' then
    update events set print_poster_url = p_public_url where id = p_event_id;
  elsif p_variant = 'table_talker' then
    update events set table_talker_url = p_public_url where id = p_event_id;
  end if;

  -- Null on a first upload. Otherwise the object the caller should remove once
  -- this transaction has committed.
  return v_previous_path;
end;
$$;

create or replace function public.delete_event_image_variant(
  p_event_id uuid,
  p_variant  text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  if p_variant not in ('square', 'landscape', 'social', 'story', 'print_poster', 'table_talker') then
    raise exception 'Unknown event image variant: %', p_variant;
  end if;

  perform 1 from events where id = p_event_id for update;
  if not found then
    raise exception 'Event % not found', p_event_id;
  end if;

  select storage_path into v_path
  from event_images
  where event_id = p_event_id and image_type = p_variant;

  -- Clear the reference first, then drop the metadata. The caller only removes
  -- the file after this commits.
  if p_variant = 'square' then
    update events
    set hero_image_url      = null,
        thumbnail_image_url = null,
        poster_image_url    = null
    where id = p_event_id;
  elsif p_variant = 'landscape' then
    update events set landscape_image_url = null where id = p_event_id;
  elsif p_variant = 'social' then
    update events set social_image_url = null where id = p_event_id;
  elsif p_variant = 'story' then
    update events set story_image_url = null where id = p_event_id;
  elsif p_variant = 'print_poster' then
    update events set print_poster_url = null where id = p_event_id;
  elsif p_variant = 'table_talker' then
    update events set table_talker_url = null where id = p_event_id;
  end if;

  delete from event_images
  where event_id = p_event_id and image_type = p_variant;

  -- Null when the object is inherited from the category and this event does not
  -- own it, so the caller has nothing to remove.
  return v_path;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants, re-issued exactly as 20260812100000 set them
--
-- CREATE OR REPLACE keeps a function's ACL, but saying it again costs nothing
-- and does not depend on that. Both functions are called only through the
-- service-role client from server code that has already checked events/edit,
-- so every other role is revoked. PUBLIC is named with the roles because
-- revoking from one without the other leaves the privilege in place.
-- ---------------------------------------------------------------------------

revoke all on function public.upsert_event_image_variant(uuid, text, text, text, text, text, integer, uuid)
  from public, anon, authenticated;
revoke all on function public.delete_event_image_variant(uuid, text)
  from public, anon, authenticated;

grant execute on function public.upsert_event_image_variant(uuid, text, text, text, text, text, integer, uuid)
  to service_role;
grant execute on function public.delete_event_image_variant(uuid, text)
  to service_role;

reset lock_timeout;

-- ---------------------------------------------------------------------------
-- 6. Refuse to finish unless the end state is right
-- ---------------------------------------------------------------------------

do $$
declare
  v_check      text;
  v_index      text;
  v_column     int;
  v_upsert     text;
  v_delete     text;
begin
  select pg_catalog.pg_get_constraintdef(oid) into v_check
  from pg_catalog.pg_constraint
  where conrelid = 'public.event_images'::regclass
    and conname = 'event_images_image_type_check';

  if v_check is null or position('table_talker' in v_check) = 0 then
    raise exception 'event_images_image_type_check does not allow table_talker: %', v_check;
  end if;

  select pg_catalog.pg_get_indexdef(i.indexrelid) into v_index
  from pg_catalog.pg_index i
  join pg_catalog.pg_class c on c.oid = i.indexrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'event_images_singleton_variant_uniq';

  if v_index is null or position('table_talker' in v_index) = 0 or position('UNIQUE' in v_index) = 0 then
    raise exception 'event_images_singleton_variant_uniq does not cover table_talker: %', v_index;
  end if;

  select count(*) into v_column
  from information_schema.columns
  where table_schema = 'public' and table_name = 'events' and column_name = 'table_talker_url'
    and data_type = 'text' and is_nullable = 'YES';

  if v_column <> 1 then
    raise exception 'events.table_talker_url is missing or not a nullable text column';
  end if;

  -- oidvectortypes, not pg_get_function_identity_arguments, which includes the
  -- parameter names and so never matches a bare type list.
  select pg_catalog.pg_get_functiondef(p.oid) into v_upsert
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'upsert_event_image_variant'
    and pg_catalog.oidvectortypes(p.proargtypes) = 'uuid, text, text, text, text, text, integer, uuid';

  select pg_catalog.pg_get_functiondef(p.oid) into v_delete
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'delete_event_image_variant'
    and pg_catalog.oidvectortypes(p.proargtypes) = 'uuid, text';

  if v_upsert is null or position('table_talker_url = p_public_url' in v_upsert) = 0 then
    raise exception 'upsert_event_image_variant does not write table_talker_url';
  end if;

  if v_delete is null or position('table_talker_url = null' in v_delete) = 0 then
    raise exception 'delete_event_image_variant does not clear table_talker_url';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('upsert_event_image_variant', 'delete_event_image_variant')
  ) <> 2 then
    raise exception 'expected exactly one of each variant RPC; an overload has appeared';
  end if;

  -- Checked with the privilege predicate, never by reading proacl as a string:
  -- an empty grantee in proacl is PUBLIC, which anon inherits.
  if pg_catalog.has_function_privilege('anon', 'public.upsert_event_image_variant(uuid, text, text, text, text, text, integer, uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.upsert_event_image_variant(uuid, text, text, text, text, text, integer, uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.delete_event_image_variant(uuid, text)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.delete_event_image_variant(uuid, text)', 'EXECUTE') then
    raise exception 'a variant RPC is callable by anon or authenticated; it must be service_role only';
  end if;

  if not pg_catalog.has_function_privilege('service_role', 'public.upsert_event_image_variant(uuid, text, text, text, text, text, integer, uuid)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', 'public.delete_event_image_variant(uuid, text)', 'EXECUTE') then
    raise exception 'service_role lost EXECUTE on a variant RPC; uploads would fail';
  end if;
end
$$;
