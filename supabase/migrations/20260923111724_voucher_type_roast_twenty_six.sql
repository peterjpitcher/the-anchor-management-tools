-- New voucher type: 20% off Sunday roasts, up to six, 23 September 2026.
--
-- APPLIED to production project tfcasgxopxegwrabvwat on 23 September 2026 as migration version
-- 20260923111724 (name: voucher_type_roast_twenty_six), through the Supabase MCP apply_migration
-- path after the owner's explicit go-ahead. Validated first on a throwaway local Postgres:
-- clean apply, idempotent re-apply, rollback, and a real card render through the print template.
-- Verified after apply: the row reads back exactly as drafted, the type appears in the generate
-- list with zero in stock, and a card rendered from the live definition.
-- The file is named after the version the ledger recorded, not its drafted timestamp
-- (supabase/migrations/README.md).
-- Rollback: supabase/rollbacks/20260923111724_voucher_type_roast_twenty_six.sql
--
-- WHY
--
-- The owner wants a ninth prize voucher: 20% off Sunday roasts, Sundays only,
-- booking only, for up to six roasts. Voucher types are data, not code: every
-- surface (generate, FOH hand-out, lookup, redeem, reminders, ledger, the
-- printed card) reads voucher_types, and nothing in src/ names a type id. So a
-- new type is this INSERT and nothing else.
--
-- WHAT THE SYSTEM DOES AND DOES NOT ENFORCE
--
-- voucher_types carries no day-of-week rule and no covers cap, so "Sundays
-- only" and "up to six" are enforced by the printed entitlement and by the
-- person at the till, exactly as they already are for roast-two, quiz-four and
-- bingo-four. FOH redeem will accept this voucher on any day. Owner decision,
-- 23 September 2026: wording first, enforcement only if it turns out to be a
-- problem.
--
-- requires_booking = true, so the card prints its "Booking required" panel and
-- the expiry reminder tells the holder to book rather than to turn up
-- (20260912191510 put that flag into the reminder claim).
--
-- VALUE
--
-- value_pence is the liability estimate, not a printed price. Live adult roasts
-- are £16 to £18 (sunday_lunch_menu_items, 23 September 2026), so six roasts is
-- about £102 and 20% of that is about £20. Owner agreed £20 on 23 September
-- 2026. Nothing prints it, and vouchers snapshot it at generation, so it can be
-- revised later for cards not yet generated.
--
-- TEXT IS PLAIN UTF-8
--
-- 20260802000004 made storage plain text and left the print template to escape
-- on the way back into HTML. entitlement_html stays genuine markup; its
-- typographic characters are literal.

insert into public.voucher_types
  (id, display_title, cover_title, value_pence, requires_booking, alcohol,
   entitlement_html, hero, copy, sort_order)
values (
  'roast-20-six',
  '20% OFF SUNDAY ROASTS',
  '20% off Sunday roasts',
  2000,
  true,
  false,
  '<p>This voucher provides 20% off Sunday roasts ordered from The Anchor’s available Sunday roast menu, for up to six roasts in one transaction.</p>'
  '<p>The discount applies to the roasts themselves only. All other food and all drinks are excluded, including starters, desserts, additional sides, upgrades and supplements. A seventh roast and beyond is charged in full.</p>'
  '<p>It is valid on an ordinary Sunday during advertised Sunday roast service. It is not valid against the Christmas menu or any special occasion menu, such as Mother’s Day, Father’s Day or Easter.</p>'
  '<p>Advance booking is required and availability is not guaranteed. The voucher may be used once only and must be redeemed in a single transaction.</p>',
  '{"kind":"word","big":"20% off","sub":"Sunday roasts"}'::jsonb,
  '{"headline":"Round up your favourite people","script":"Sunday is better with a full table","prize":"20% off Sunday roasts for up to six","open":"Save this for Sunday","aside":"Up to six roasts at the table, each one twenty per cent off.","community":"There is always room at the table."}'::jsonb,
  9
)
on conflict (id) do nothing;

-- Fail loudly rather than half-applying. The card template throws on a missing
-- hero or copy key, so a bad definition would break a whole batch print at
-- render time; check it here instead, where the blast radius is one migration.
do $check$
declare
  v_row public.voucher_types%rowtype;
  v_key text;
begin
  select * into v_row from public.voucher_types where id = 'roast-20-six';
  if not found then
    raise exception 'roast-20-six was not inserted';
  end if;

  if v_row.value_pence is null then
    raise exception 'roast-20-six has no value_pence; every type must carry one (20260802000006)';
  end if;

  foreach v_key in array array['kind','big','sub'] loop
    if coalesce(v_row.hero ->> v_key, '') = '' then
      raise exception 'roast-20-six hero is missing %', v_key;
    end if;
  end loop;

  foreach v_key in array array['headline','script','prize','open','aside','community'] loop
    if coalesce(v_row.copy ->> v_key, '') = '' then
      raise exception 'roast-20-six copy is missing %', v_key;
    end if;
  end loop;

  if v_row.display_title like '%&%;%'
     or v_row.cover_title like '%&%;%'
     or v_row.hero::text like '%&%;%'
     or v_row.copy::text like '%&%;%' then
    raise exception 'roast-20-six stores HTML entities; storage is plain text (20260802000004)';
  end if;

  if (select count(*) from public.voucher_types where sort_order = v_row.sort_order) > 1 then
    raise exception 'sort_order 9 is already taken; the generate screen orders by it';
  end if;
end
$check$;

-- No new table, view or SECURITY DEFINER routine, so the anon surface is
-- unchanged and assert-anon-surface has nothing new to check.
--
-- No batch snapshot repair: this type has never been generated, so no
-- voucher_batches.type_definitions entry and no vouchers row refers to it.
