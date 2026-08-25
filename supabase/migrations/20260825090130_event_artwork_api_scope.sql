-- Scoped event artwork for CheersAI.
--
-- Adds the `read:events:artwork` scope and grants it to the single active key
-- named "cheersai". The scope gates GET /api/events/{id}/artwork, which is the
-- only route that emits the story and print-poster URLs.
--
-- Purely additive. No existing route reads this scope, so applying it ahead of
-- the code deploy changes nothing, and rolling the code back leaves an unused
-- scope rather than a broken one.

-- ---------------------------------------------------------------------------
-- 1. Grant the scope
--
-- Idempotent: the append only fires when the scope is missing, and `||`
-- preserves every other entry.
--
-- The row-count check matters. An UPDATE that matches nothing still reports
-- success, so without it a renamed or rotated key would silently ship a feature
-- that can never return artwork. A database with no cheersai key at all (fresh
-- or local) is a different case and is allowed through with a notice.
-- ---------------------------------------------------------------------------

do $$
declare
  v_candidates int;
  v_already    int;
  v_updated    int;
begin
  select count(*) into v_candidates
  from public.api_keys
  where lower(name) = 'cheersai'
    and is_active = true
    and jsonb_typeof(permissions) = 'array';

  select count(*) into v_already
  from public.api_keys
  where lower(name) = 'cheersai'
    and is_active = true
    and jsonb_typeof(permissions) = 'array'
    and (permissions ? 'read:events:artwork' or permissions ? '*');

  update public.api_keys
  set
    permissions = permissions || '["read:events:artwork"]'::jsonb,
    updated_at = now()
  where lower(name) = 'cheersai'
    and is_active = true
    and jsonb_typeof(permissions) = 'array'
    and permissions ? 'read:events'
    and not permissions ? 'read:events:artwork'
    and not permissions ? '*';

  get diagnostics v_updated = row_count;

  if v_candidates = 0 then
    raise notice
      'No active api_keys row named "cheersai". Skipping the artwork scope grant. Grant it through Settings > API Keys before pointing CheersAI at this environment.';
  elsif v_updated = 0 and v_already = 0 then
    raise exception
      'Found % active "cheersai" key(s) but granted the artwork scope to none of them. Check the key still holds read:events.', v_candidates;
  else
    raise notice 'Artwork scope: % key(s) updated, % already held it.', v_updated, v_already;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Correct the column comments
--
-- These said "Never emitted by the public API", which stops being true the
-- moment the scoped artwork endpoint ships. Left as-is they would send the next
-- person changing this area to the wrong conclusion.
-- ---------------------------------------------------------------------------

comment on column public.events.story_image_url is
  '9:16 artwork. Not part of the website-facing image fields; served only through GET /api/events/{id}/artwork, which requires the read:events:artwork scope.';

comment on column public.events.print_poster_url is
  'A4 print artwork, image or PDF. Not part of the website-facing image fields; served only through GET /api/events/{id}/artwork, which requires the read:events:artwork scope.';
