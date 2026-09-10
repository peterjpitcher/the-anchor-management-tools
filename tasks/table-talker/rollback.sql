-- ROLLBACK for 20260910105320_event_image_table_talker. Not a migration file; run only if the owner asks.
--
-- Safe only while no table_talker rows exist: re-adding the narrower CHECK fails loudly
-- if any do, which is deliberate. Delete those rows (and their storage objects) first,
-- with the owner's approval, or forward-fix instead.
--
-- events.table_talker_url is left in place on purpose. The old code never reads it,
-- it is nullable, and dropping it would destroy any table talker URLs recorded since.

set lock_timeout = '3s';

alter table public.event_images
  drop constraint if exists event_images_image_type_check;

alter table public.event_images
  add constraint event_images_image_type_check
  check (image_type in (
    'square', 'landscape', 'social', 'story', 'print_poster',
    'gallery',
    'hero', 'thumbnail', 'poster'
  ));

drop index if exists public.event_images_singleton_variant_uniq;

create unique index event_images_singleton_variant_uniq
  on public.event_images (event_id, image_type)
  where image_type in ('square', 'landscape', 'social', 'story', 'print_poster');

-- The two RPCs exactly as production held them before (20260812100000, verified
-- with pg_get_functiondef on 2026-09-10), with their grants.
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

revoke all on function public.upsert_event_image_variant(uuid, text, text, text, text, text, integer, uuid)
  from public, anon, authenticated;
revoke all on function public.delete_event_image_variant(uuid, text)
  from public, anon, authenticated;

grant execute on function public.upsert_event_image_variant(uuid, text, text, text, text, text, integer, uuid)
  to service_role;
grant execute on function public.delete_event_image_variant(uuid, text)
  to service_role;

reset lock_timeout;
