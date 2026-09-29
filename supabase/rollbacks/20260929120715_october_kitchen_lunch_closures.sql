-- Rollback for 20260929120715_october_kitchen_lunch_closures.sql (drafted as 20260929130207).
-- Removes the four special_hours rows only if they are still exactly as that migration left
-- them, and puts both October round-ups back to the Halloween-only dates block, guarded on the
-- copy the change left, so a later edit is never reverted. Do not run after 1 October 2026
-- 09:00 London: the round-ups will have sent and the email half no longer matters.

do $$
begin
  delete from public.special_hours
  where date in ('2026-10-20'::date, '2026-10-23'::date, '2026-10-27'::date, '2026-10-30'::date)
    and opens = '12:00' and closes = '22:00' and kitchen_opens = '16:00' and kitchen_closes = '21:00'
    and note = 'Kitchen closed for lunch. Bar open 12pm to 10pm as usual, food 4pm to 9pm.';
  if (select count(*) from public.special_hours where date in ('2026-10-20'::date, '2026-10-23'::date, '2026-10-27'::date, '2026-10-30'::date)) > 0 then
    raise exception 'A closure date has been edited since the migration, so the hours were left alone';
  end if;

  -- Welcome to October - guests - 2026: back to the Halloween-only dates block
  update public.marketing_campaigns set
    content = jsonb_set(content, '{blocks,4,data}', '{"rows":[{"date":"Sat 31 Oct","note":"Full menu 12pm to 6pm, kitchen shut 6pm to 9pm, then pizza only","hours":"12pm to midnight"}],"heading":"One date is different","footnote":"Halloween is the only date in October that differs from the week above. Pizza from 9pm is available to eat in or to take away."}'::jsonb),
    content_hash = '7164703aa754f09082f839e67887f4a15415d9ad29230531a66786b57d39b023',
    updated_at = now()
  where utm_campaign = 'october-2026-roundup-guests'
    and status = 'scheduled'
    and content_hash = '03b753de3cd95b2477fbd1e9fe122756282bf855ab027e6108cd00c8cc91a1d2'
    and content #> '{blocks,4,data}' = '{"rows":[{"date":"Tue 20 Oct","hours":"12pm to 10pm","note":"Kitchen closed for lunch, dinner 4pm to 9pm as usual"},{"date":"Fri 23 Oct","hours":"12pm to 10pm","note":"Kitchen closed for lunch, dinner 4pm to 9pm as usual"},{"date":"Tue 27 Oct","hours":"12pm to 10pm","note":"Kitchen closed for lunch, dinner 4pm to 9pm as usual"},{"date":"Fri 30 Oct","hours":"12pm to 10pm","note":"Kitchen closed for lunch, dinner 4pm to 9pm as usual"},{"date":"Sat 31 Oct","note":"Full menu 12pm to 6pm, kitchen shut 6pm to 9pm, then pizza only","hours":"12pm to midnight"}],"heading":"Five dates are different","footnote":"The bar opens at 12pm as normal on those four days, and food starts at 4pm. On Halloween, pizza from 9pm is available to eat in or to take away."}'::jsonb;
  if not found then
    raise exception '% is not on the copy this rollback undoes, so it was left alone', 'october-2026-roundup-guests';
  end if;
  -- Welcome to October - businesses - 2026: back to the Halloween-only dates block
  update public.marketing_campaigns set
    content = jsonb_set(content, '{blocks,4,data}', '{"rows":[{"date":"Sat 31 Oct","note":"Full menu 12pm to 6pm, kitchen shut 6pm to 9pm, then pizza only","hours":"12pm to midnight"}],"heading":"One date is different","footnote":"Halloween is the only date in October that differs from the week above. Pizza from 9pm is available to eat in or to take away."}'::jsonb),
    content_hash = '8e8d33553cfe03055cdbed2a89b63b0126e34ade1f3e50eb85f3bb20a3be97df',
    updated_at = now()
  where utm_campaign = 'october-2026-roundup-business'
    and status = 'scheduled'
    and content_hash = '0e73cc1baa1b53ea3a3efcb321a3c592c179e03922a8c121f7048279cc3ed2e2'
    and content #> '{blocks,4,data}' = '{"rows":[{"date":"Tue 20 Oct","hours":"12pm to 10pm","note":"Kitchen closed for lunch, dinner 4pm to 9pm as usual"},{"date":"Fri 23 Oct","hours":"12pm to 10pm","note":"Kitchen closed for lunch, dinner 4pm to 9pm as usual"},{"date":"Tue 27 Oct","hours":"12pm to 10pm","note":"Kitchen closed for lunch, dinner 4pm to 9pm as usual"},{"date":"Fri 30 Oct","hours":"12pm to 10pm","note":"Kitchen closed for lunch, dinner 4pm to 9pm as usual"},{"date":"Sat 31 Oct","note":"Full menu 12pm to 6pm, kitchen shut 6pm to 9pm, then pizza only","hours":"12pm to midnight"}],"heading":"Five dates are different","footnote":"The bar opens at 12pm as normal on those four days, and food starts at 4pm. On Halloween, pizza from 9pm is available to eat in or to take away."}'::jsonb;
  if not found then
    raise exception '% is not on the copy this rollback undoes, so it was left alone', 'october-2026-roundup-business';
  end if;
end $$;
