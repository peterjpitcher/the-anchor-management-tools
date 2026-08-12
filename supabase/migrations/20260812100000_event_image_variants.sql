-- Event image variants: schema, storage and RPCs.
--
-- Purely additive. Every value the currently deployed code can write is retained,
-- so this is safe to apply ahead of any code deploy and safe to roll code back
-- under. Legacy values are removed in a later cleanup migration, not here.

-- ---------------------------------------------------------------------------
-- 1. Widen the allowed variant list
-- ---------------------------------------------------------------------------

alter table public.event_images
  drop constraint if exists event_images_image_type_check;

alter table public.event_images
  add constraint event_images_image_type_check
  check (image_type in (
    -- current vocabulary
    'square', 'landscape', 'social', 'story', 'print_poster',
    -- multi-row type, unchanged
    'gallery',
    -- legacy, retained for rollback safety until the cleanup migration
    'hero', 'thumbnail', 'poster'
  ));

-- ---------------------------------------------------------------------------
-- 2. Map existing rows onto the new vocabulary
-- ---------------------------------------------------------------------------

update public.event_images
set image_type = 'square'
where image_type = 'hero';

-- ---------------------------------------------------------------------------
-- 3. Dedupe the singleton variants, keeping the newest row per pair
--
-- Gallery is deliberately excluded: it is a multi-row type ordered by
-- display_order, and deduping it would destroy data in any environment that has
-- it. Storage objects are NOT removed here, so this cannot break a live image.
-- Removed rows are kept in a backup table until the cleanup migration.
-- ---------------------------------------------------------------------------

create table if not exists public.event_images_dedupe_backup_20260812
  (like public.event_images including defaults);

alter table public.event_images_dedupe_backup_20260812 enable row level security;

comment on table public.event_images_dedupe_backup_20260812 is
  'Surplus event_images rows removed by the 20260812 variant migration. Drop once the release is settled.';

with ranked as (
  select
    id,
    row_number() over (
      partition by event_id, image_type
      order by created_at desc, id desc
    ) as rn
  from public.event_images
  where image_type in ('square', 'landscape', 'social', 'story', 'print_poster')
)
insert into public.event_images_dedupe_backup_20260812
select ei.*
from public.event_images ei
join ranked r on r.id = ei.id
where r.rn > 1;

delete from public.event_images ei
using public.event_images_dedupe_backup_20260812 b
where b.id = ei.id;

-- ---------------------------------------------------------------------------
-- 4. One row per event per singleton variant. Gallery keeps its multiplicity.
-- ---------------------------------------------------------------------------

create unique index if not exists event_images_singleton_variant_uniq
  on public.event_images (event_id, image_type)
  where image_type in ('square', 'landscape', 'social', 'story', 'print_poster');

-- ---------------------------------------------------------------------------
-- 5. Denormalised read cache on events
--
-- hero_image_url, thumbnail_image_url and poster_image_url are deliberately left
-- alone. They hold the square and continue to do so.
-- ---------------------------------------------------------------------------

alter table public.events
  add column if not exists landscape_image_url text,
  add column if not exists social_image_url    text,
  add column if not exists story_image_url     text,
  add column if not exists print_poster_url    text;

comment on column public.events.landscape_image_url is '16:9 artwork, website hero';
comment on column public.events.social_image_url    is '1.91:1 artwork, Facebook event cover and link preview';
comment on column public.events.story_image_url     is '9:16 artwork. Never emitted by the public API';
comment on column public.events.print_poster_url    is 'A4 print artwork, image or PDF. Never emitted by the public API';

-- ---------------------------------------------------------------------------
-- 6. Storage bucket: raise the cap and allow PDF for the print poster.
--
-- The row-count guard matters. An UPDATE that matches nothing still reports
-- success, so without it a typo would silently leave PDF unsupported and the
-- migration would look like it had worked.
-- ---------------------------------------------------------------------------

do $$
declare
  affected int;
begin
  update storage.buckets
  set file_size_limit = 26214400, -- 25 MB
      allowed_mime_types = array[
        'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
        'application/pdf'
      ]
  where id = 'event-images';

  get diagnostics affected = row_count;

  if affected <> 1 then
    raise exception
      'event-images bucket was not updated (% rows affected). Aborting.', affected;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. RPCs
--
-- Storage and Postgres cannot share a transaction, so the goal is not atomicity
-- across both. It is that the metadata row and the cache column can never
-- disagree, and that storage is only ever touched in the safe order: the caller
-- removes the old object AFTER these commit, so a reference is never left
-- pointing at a deleted file.
-- ---------------------------------------------------------------------------

-- The cache columns on `events` hold the full public URL, not the bucket-relative
-- storage path, so both are passed in. event_images.storage_path is what storage
-- operations need; the columns are what the API and website read.
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
  if p_variant not in ('square', 'landscape', 'social', 'story', 'print_poster') then
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
  end if;

  -- Null on a first upload. Otherwise the object the caller should remove once
  -- this transaction has committed.
  return v_previous_path;
end;
$$;

comment on function public.upsert_event_image_variant is
  'Records an uploaded event image variant and updates the events cache column in one transaction. Returns the storage path it replaced, for the caller to clean up AFTER this commits.';

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
  if p_variant not in ('square', 'landscape', 'social', 'story', 'print_poster') then
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
  end if;

  delete from event_images
  where event_id = p_event_id and image_type = p_variant;

  -- Null when the object is inherited from the category and this event does not
  -- own it, so the caller has nothing to remove.
  return v_path;
end;
$$;

comment on function public.delete_event_image_variant is
  'Clears an event image variant reference and its metadata in one transaction. Returns the storage path to remove AFTER this commits, or null when the event owns no file for that variant.';

-- ---------------------------------------------------------------------------
-- 8. Grants
--
-- New public functions receive EXECUTE for anon and authenticated by default in
-- this project. Both of these are called with the service-role client from a
-- server action that has already checked the events/edit permission, so every
-- other role is revoked.
-- ---------------------------------------------------------------------------

revoke all on function public.upsert_event_image_variant(uuid, text, text, text, text, text, integer, uuid)
  from public, anon, authenticated;
revoke all on function public.delete_event_image_variant(uuid, text)
  from public, anon, authenticated;

grant execute on function public.upsert_event_image_variant(uuid, text, text, text, text, text, integer, uuid)
  to service_role;
grant execute on function public.delete_event_image_variant(uuid, text)
  to service_role;
