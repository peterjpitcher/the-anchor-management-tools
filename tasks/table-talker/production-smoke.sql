-- Production smoke test for the event_image_table_talker migration.
-- Not a migration file. Read-only in effect: everything happens inside one DO
-- block that ALWAYS ends by raising, so every write it makes is rolled back.
--
-- Expected result: an ERROR whose message starts "SMOKE_OK:". Any other error
-- is a real failure. Then run the follow-up query at the bottom, which must
-- return 0.
--
-- It uses a throwaway event it creates itself, never a real one. The project
-- has no http, pg_net or dblink extension, so no trigger can send anything
-- outside the transaction before it rolls back.

do $$
declare
  e uuid := gen_random_uuid();
  v text;
  n int;
begin
  insert into public.events (id, name, date, time, slug)
  values (e, 'zz migration smoke test', current_date + 30, '19:00', 'zz-migration-smoke-' || replace(e::text, '-', ''));

  v := public.upsert_event_image_variant(e, 'table_talker', 'events/' || e || '/table_talker/1_a.png', 'https://example.invalid/1_a.png', 'a.png', 'image/png', 10, null);
  if v is not null then raise exception 'first upsert returned %', v; end if;
  if (select table_talker_url from public.events where id = e) is distinct from 'https://example.invalid/1_a.png' then
    raise exception 'table_talker_url was not written';
  end if;

  v := public.upsert_event_image_variant(e, 'table_talker', 'events/' || e || '/table_talker/2_b.png', 'https://example.invalid/2_b.png', 'b.png', 'image/png', 11, null);
  if v is distinct from 'events/' || e || '/table_talker/1_a.png' then raise exception 'replace returned %', v; end if;
  select count(*) into n from public.event_images where event_id = e and image_type = 'table_talker';
  if n <> 1 then raise exception 'expected one table_talker row, found %', n; end if;

  begin
    insert into public.event_images (event_id, image_type, storage_path, file_name, mime_type, file_size_bytes)
    values (e, 'table_talker', 'dup', 'dup', 'image/png', 1);
    raise exception 'a second table_talker row was accepted';
  exception when unique_violation then
    null; -- expected: one row per event per variant
  end;

  v := public.delete_event_image_variant(e, 'table_talker');
  if v is distinct from 'events/' || e || '/table_talker/2_b.png' then raise exception 'delete returned %', v; end if;
  if (select table_talker_url from public.events where id = e) is not null then
    raise exception 'table_talker_url was not cleared';
  end if;

  begin
    perform public.upsert_event_image_variant(e, 'bogus', 'p', 'u', 'f', 'image/png', 1, null);
    raise exception 'an unknown variant was accepted';
  exception when raise_exception then
    if sqlerrm not like 'Unknown event image variant%' then raise; end if;
  end;

  raise exception 'SMOKE_OK: table_talker upsert, replace, duplicate refusal, delete and unknown-type refusal all behaved; rolling back';
end
$$;

-- Follow-up: must return 0.
-- select count(*) from public.events where slug like 'zz-migration-smoke-%';
