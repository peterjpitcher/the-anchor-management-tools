-- APPLIED to production (tfcasgxopxegwrabvwat) on 29 September 2026 as version 20260929120715.
-- Drafted as 20260929130207, which is the label the audit rows
-- carry; the statements are unchanged from the dry-run-tested draft.
--
-- October 2026 kitchen lunch closures, requested by the owner on 29 September 2026.
--
-- The kitchen is closed 12pm to 3pm on Tue 20, Fri 23, Tue 27 and Fri 30 October 2026. Dinner
-- runs 4pm to 9pm as normal on each of those days and the bar keeps its regular 12pm to 10pm.
-- No table bookings, private bookings or events existed on any of the four dates when this
-- was written, so nobody holds a lunch booking that this refuses.
--
-- 1. Four special_hours rows, exactly as the settings screen would save them, then the legacy
--    slot regeneration that screen runs. Refuses to run if any of the dates already has a
--    special_hours row, or if the regular hours for those dates are no longer 12pm to 10pm
--    with the kitchen 12pm to 9pm, because the bar hours below were copied from them.
-- 2. Both scheduled "Welcome to October" round-ups (1 October 2026, 09:00 London) get the four
--    dates in their dates block, which named Halloween alone and called it the only date that
--    differs. Guarded on the block's current value, the reviewed content_hash and the status,
--    so a campaign anyone has edited since is left alone and the whole statement raises. The
--    new content_hash values were computed from the edited content by
--    scripts/one-off/generate-october-kitchen-lunch-closures-2026-09-29.ts, whose --verify
--    pass reproduces each hash from the stored content afterwards.
--
-- Nothing here sends an email or moves a send time. Rollback: supabase/rollbacks/20260929120715_october_kitchen_lunch_closures.sql

do $$
declare
  v_slots jsonb;
begin
  if exists (select 1 from public.special_hours where date in ('2026-10-20'::date, '2026-10-23'::date, '2026-10-27'::date, '2026-10-30'::date)) then
    raise exception 'A special_hours row already exists for one of the October closure dates, so nothing was changed';
  end if;

  if exists (
    select 1
    from unnest(array['2026-10-20'::date, '2026-10-23'::date, '2026-10-27'::date, '2026-10-30'::date]) as d(day)
    where not exists (
      select 1 from public.business_hours_for_date(d.day) bh
      where bh.opens = '12:00' and bh.closes = '22:00'
        and bh.kitchen_opens = '12:00' and bh.kitchen_closes = '21:00'
        and not coalesce(bh.is_closed, false) and not coalesce(bh.is_kitchen_closed, false)
    )
  ) then
    raise exception 'The regular hours for an October closure date are no longer the ones this was written against';
  end if;

  insert into public.special_hours (date, opens, closes, kitchen_opens, kitchen_closes, is_closed, is_kitchen_closed, note, schedule_config)
  values
    ('2026-10-20', '12:00', '22:00', '16:00', '21:00', false, false, 'Kitchen closed for lunch. Bar open 12pm to 10pm as usual, food 4pm to 9pm.', '[{"name":"Dinner","ends_at":"21:00","capacity":50,"starts_at":"16:00","booking_type":"regular"}]'::jsonb),
    ('2026-10-23', '12:00', '22:00', '16:00', '21:00', false, false, 'Kitchen closed for lunch. Bar open 12pm to 10pm as usual, food 4pm to 9pm.', '[{"name":"Dinner","ends_at":"21:00","capacity":50,"starts_at":"16:00","booking_type":"regular"}]'::jsonb),
    ('2026-10-27', '12:00', '22:00', '16:00', '21:00', false, false, 'Kitchen closed for lunch. Bar open 12pm to 10pm as usual, food 4pm to 9pm.', '[{"name":"Dinner","ends_at":"21:00","capacity":50,"starts_at":"16:00","booking_type":"regular"}]'::jsonb),
    ('2026-10-30', '12:00', '22:00', '16:00', '21:00', false, false, 'Kitchen closed for lunch. Bar open 12pm to 10pm as usual, food 4pm to 9pm.', '[{"name":"Dinner","ends_at":"21:00","capacity":50,"starts_at":"16:00","booking_type":"regular"}]'::jsonb);

  insert into public.audit_logs (user_id, operation_type, resource_type, resource_id, operation_status, new_values, additional_info)
  values (null, 'create', 'settings', 'special_hours', 'success',
    jsonb_build_object('created_dates', jsonb_build_array('2026-10-20', '2026-10-23', '2026-10-27', '2026-10-30')),
    jsonb_build_object('migration', '20260929130207_october_kitchen_lunch_closures', 'reason', 'Kitchen closed 12pm to 3pm, dinner 4pm to 9pm as normal'));

  -- The settings screen runs this after every hours write and treats a failure as non-fatal;
  -- service_slots is legacy and not used to validate bookings.
  begin
    v_slots := public.auto_generate_weekly_slots();
  exception when others then
    raise warning 'auto_generate_weekly_slots failed (non-fatal): %', sqlerrm;
  end;

  -- Welcome to October - guests - 2026: dates block at blocks.4
  update public.marketing_campaigns set
    content = jsonb_set(content, '{blocks,4,data}', '{"rows":[{"date":"Tue 20 Oct","hours":"12pm to 10pm","note":"Kitchen closed for lunch, dinner 4pm to 9pm as usual"},{"date":"Fri 23 Oct","hours":"12pm to 10pm","note":"Kitchen closed for lunch, dinner 4pm to 9pm as usual"},{"date":"Tue 27 Oct","hours":"12pm to 10pm","note":"Kitchen closed for lunch, dinner 4pm to 9pm as usual"},{"date":"Fri 30 Oct","hours":"12pm to 10pm","note":"Kitchen closed for lunch, dinner 4pm to 9pm as usual"},{"date":"Sat 31 Oct","note":"Full menu 12pm to 6pm, kitchen shut 6pm to 9pm, then pizza only","hours":"12pm to midnight"}],"heading":"Five dates are different","footnote":"The bar opens at 12pm as normal on those four days, and food starts at 4pm. On Halloween, pizza from 9pm is available to eat in or to take away."}'::jsonb),
    content_hash = '03b753de3cd95b2477fbd1e9fe122756282bf855ab027e6108cd00c8cc91a1d2',
    updated_at = now()
  where utm_campaign = 'october-2026-roundup-guests'
    and status = 'scheduled'
    and content_hash = '7164703aa754f09082f839e67887f4a15415d9ad29230531a66786b57d39b023'
    and content #>> '{blocks,4,type}' = 'opening_hours_dates'
    and content #> '{blocks,4,data}' = '{"rows":[{"date":"Sat 31 Oct","note":"Full menu 12pm to 6pm, kitchen shut 6pm to 9pm, then pizza only","hours":"12pm to midnight"}],"heading":"One date is different","footnote":"Halloween is the only date in October that differs from the week above. Pizza from 9pm is available to eat in or to take away."}'::jsonb;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'october-2026-roundup-guests';
  end if;
  insert into public.audit_logs (user_id, operation_type, resource_type, resource_id, operation_status, old_values, new_values, additional_info)
  values (null, 'update', 'marketing_campaign', 'e736d9f4-aa50-41cb-ab2e-689a6fa70ca2', 'success',
    jsonb_build_object('content_hash', '7164703aa754f09082f839e67887f4a15415d9ad29230531a66786b57d39b023'),
    jsonb_build_object('content_hash', '03b753de3cd95b2477fbd1e9fe122756282bf855ab027e6108cd00c8cc91a1d2'),
    jsonb_build_object('migration', '20260929130207_october_kitchen_lunch_closures', 'reason', 'October 2026 kitchen lunch closures added to the dates block'));
  -- Welcome to October - businesses - 2026: dates block at blocks.4
  -- Its stored hash predates the 12 September consent-footer rewrite, which changed content
  -- only; the new hash is taken over the full current content, so it is correct again.
  update public.marketing_campaigns set
    content = jsonb_set(content, '{blocks,4,data}', '{"rows":[{"date":"Tue 20 Oct","hours":"12pm to 10pm","note":"Kitchen closed for lunch, dinner 4pm to 9pm as usual"},{"date":"Fri 23 Oct","hours":"12pm to 10pm","note":"Kitchen closed for lunch, dinner 4pm to 9pm as usual"},{"date":"Tue 27 Oct","hours":"12pm to 10pm","note":"Kitchen closed for lunch, dinner 4pm to 9pm as usual"},{"date":"Fri 30 Oct","hours":"12pm to 10pm","note":"Kitchen closed for lunch, dinner 4pm to 9pm as usual"},{"date":"Sat 31 Oct","note":"Full menu 12pm to 6pm, kitchen shut 6pm to 9pm, then pizza only","hours":"12pm to midnight"}],"heading":"Five dates are different","footnote":"The bar opens at 12pm as normal on those four days, and food starts at 4pm. On Halloween, pizza from 9pm is available to eat in or to take away."}'::jsonb),
    content_hash = '0e73cc1baa1b53ea3a3efcb321a3c592c179e03922a8c121f7048279cc3ed2e2',
    updated_at = now()
  where utm_campaign = 'october-2026-roundup-business'
    and status = 'scheduled'
    and content_hash = '8e8d33553cfe03055cdbed2a89b63b0126e34ade1f3e50eb85f3bb20a3be97df'
    and content #>> '{blocks,4,type}' = 'opening_hours_dates'
    and content #> '{blocks,4,data}' = '{"rows":[{"date":"Sat 31 Oct","note":"Full menu 12pm to 6pm, kitchen shut 6pm to 9pm, then pizza only","hours":"12pm to midnight"}],"heading":"One date is different","footnote":"Halloween is the only date in October that differs from the week above. Pizza from 9pm is available to eat in or to take away."}'::jsonb;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'october-2026-roundup-business';
  end if;
  insert into public.audit_logs (user_id, operation_type, resource_type, resource_id, operation_status, old_values, new_values, additional_info)
  values (null, 'update', 'marketing_campaign', 'acfcfbb5-893d-4d2a-ba37-c85adfbcff1d', 'success',
    jsonb_build_object('content_hash', '8e8d33553cfe03055cdbed2a89b63b0126e34ade1f3e50eb85f3bb20a3be97df'),
    jsonb_build_object('content_hash', '0e73cc1baa1b53ea3a3efcb321a3c592c179e03922a8c121f7048279cc3ed2e2'),
    jsonb_build_object('migration', '20260929130207_october_kitchen_lunch_closures', 'reason', 'October 2026 kitchen lunch closures added to the dates block'));

  if exists (
    select 1 from public.marketing_campaigns
    where status = 'scheduled' and utm_campaign in ('october-2026-roundup-guests', 'october-2026-roundup-business')
      and (content::text like '%only date in October%' or content::text not like '%Tue 20 Oct%' or content::text not like '%Fri 30 Oct%')
  ) then
    raise exception 'An October round-up does not carry the lunch closures';
  end if;
end $$;
