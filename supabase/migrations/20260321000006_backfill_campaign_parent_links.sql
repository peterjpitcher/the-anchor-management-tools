-- Backfill parent_link_id for existing event marketing links.
--
-- Strategy:
-- 1. For each unique event_id in metadata, find links that have a known channel
--    (metadata->>'channel' is not null and not 'unknown')
-- 2. Among those, create a parent link if none exists:
--    - Parent = a new link with the base destination URL (stripped of UTM params),
--      link_type = 'promotion', name = event name from metadata
-- 3. Set parent_link_id on all channel variant links for that event
-- 4. Legacy "unknown" channel links stay as standalone (they predate the channel system)
--
-- This is idempotent — running twice won't create duplicate parents.

do $$
declare
  v_event_id text;
  v_event_name text;
  v_base_url text;
  v_parent_id uuid;
  v_link record;
  v_event_cursor cursor for
    select distinct
      metadata->>'event_id' as event_id,
      metadata->>'event_name' as event_name
    from short_links
    where metadata->>'event_id' is not null
      and metadata->>'channel' is not null
      and metadata->>'channel' != 'unknown'
      and parent_link_id is null
    order by metadata->>'event_name';
begin
  open v_event_cursor;
  loop
    fetch v_event_cursor into v_event_id, v_event_name;
    exit when not found;

    -- Skip if event_id is empty
    if v_event_id is null or v_event_id = '' then
      continue;
    end if;

    -- Get the base URL from the first channel variant (strip UTM query params)
    select split_part(destination_url, '?', 1)
    into v_base_url
    from short_links
    where metadata->>'event_id' = v_event_id
      and metadata->>'channel' is not null
      and metadata->>'channel' != 'unknown'
      and parent_link_id is null
    limit 1;

    if v_base_url is null then
      continue;
    end if;

    -- Check if a parent link already exists for this base URL
    select id into v_parent_id
    from short_links
    where destination_url = v_base_url
      and parent_link_id is null
      and (metadata->>'channel' is null or metadata->>'channel' = '')
    limit 1;

    -- If no parent exists, create one
    if v_parent_id is null then
      insert into short_links (
        id, short_code, destination_url, link_type, name, metadata, parent_link_id, click_count, created_at, updated_at
      ) values (
        gen_random_uuid(),
        -- Generate a short code: 'evt' + first 5 chars of event_id (no hyphens)
        'evt' || left(replace(v_event_id, '-', ''), 5),
        v_base_url,
        'promotion',
        coalesce(v_event_name, 'Event Campaign'),
        jsonb_build_object('event_id', v_event_id, 'event_name', v_event_name, 'backfill_parent', true),
        null,  -- parent_link_id is null (this IS the parent)
        0,
        now(),
        now()
      )
      on conflict (short_code) do nothing
      returning id into v_parent_id;

      -- If short_code conflicted, try with a random suffix
      if v_parent_id is null then
        insert into short_links (
          id, short_code, destination_url, link_type, name, metadata, parent_link_id, click_count, created_at, updated_at
        ) values (
          gen_random_uuid(),
          'evt' || left(replace(v_event_id, '-', ''), 5) || substr(md5(random()::text), 1, 3),
          v_base_url,
          'promotion',
          coalesce(v_event_name, 'Event Campaign'),
          jsonb_build_object('event_id', v_event_id, 'event_name', v_event_name, 'backfill_parent', true),
          null,
          0,
          now(),
          now()
        )
        returning id into v_parent_id;
      end if;
    end if;

    -- Set parent_link_id on all channel variants for this event
    if v_parent_id is not null then
      update short_links
      set parent_link_id = v_parent_id,
          updated_at = now()
      where metadata->>'event_id' = v_event_id
        and metadata->>'channel' is not null
        and metadata->>'channel' != 'unknown'
        and parent_link_id is null
        and id != v_parent_id;

      raise notice 'Backfilled event: % — parent: %', coalesce(v_event_name, v_event_id), v_parent_id;
    end if;
  end loop;
  close v_event_cursor;
end;
$$;
