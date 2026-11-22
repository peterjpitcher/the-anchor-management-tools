-- Hold return-visit offers for 14 days after a no-show email (owner decision C, 22 November 2026).
--
-- get_table_return_visit_audience leaves out any customer who was sent the morning-after no-show
-- email in the last 14 London days (the day it was sent and the 13 after it), so "did we miss you"
-- is never followed straight away by a voucher. That is the only change: the body is otherwise the
-- live one (pg_get_functiondef on 22 November 2026, md5 93c2316c90fac53c2062412701ccbcfd), and
-- SECURITY DEFINER, STABLE, the pinned search_path and the grants (service_role only) are restated.
--
-- Needs 20261122200000_table_booking_no_show_follow_up.sql first (the column it reads). Safe to
-- apply before the code deploys: until the email is switched on no booking carries a send time,
-- so the audience is exactly what it was.
--
-- Tested by scripts/testing/no-show-follow-up-postgres.py.
--
-- Rollback: re-run section 5 of 20261102210508_return_visit_lifecycle.sql.

begin;

create or replace function public.get_table_return_visit_audience(p_filter jsonb, p_london_today date default null)
returns table (
  customer_id uuid,
  first_name text,
  email text,
  anchor_date date,
  anchor_was_sunday boolean,
  anchor_was_no_show boolean,
  last_party_size integer,
  visit_count integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_today date := coalesce(p_london_today, (now() at time zone 'Europe/London')::date);
  v_touch integer := coalesce((p_filter ->> 'touch')::integer, 0);
  v_include_no_shows boolean := coalesce((p_filter ->> 'include_no_shows')::boolean, true);
  v_min integer := (p_filter ->> 'days_since_anchor_min')::integer;
  v_max integer := (p_filter ->> 'days_since_anchor_max')::integer;
  v_previous uuid := nullif(p_filter ->> 'previous_campaign_id', '')::uuid;
  v_since_previous integer := coalesce((p_filter ->> 'days_since_previous_touch_min')::integer, 45);
begin
  if coalesce(p_filter ->> 'rule', '') <> 'table_return_visit' then
    raise exception 'get_table_return_visit_audience: unknown rule %', p_filter ->> 'rule';
  end if;
  if v_touch not in (1, 2) then
    raise exception 'get_table_return_visit_audience: touch must be 1 or 2, got %', p_filter ->> 'touch';
  end if;
  if v_touch = 1 and (v_min is null or v_max is null or v_min < 1 or v_max < v_min) then
    raise exception 'get_table_return_visit_audience: touch 1 needs days_since_anchor_min and _max';
  end if;
  if v_touch = 2 and v_previous is null then
    raise exception 'get_table_return_visit_audience: touch 2 needs previous_campaign_id';
  end if;

  return query
  with qualifying as (
    select t.customer_id, t.booking_date, t.booking_time, t.party_size, (t.status::text = 'no_show') as no_show
    from table_bookings t
    where t.customer_id is not null
      and t.booking_date < v_today
      and (t.status::text in ('completed', 'confirmed', 'visited_waiting_for_review', 'review_clicked')
           or (v_include_no_shows and t.status::text = 'no_show'))
      and not t.is_venue_event
      and t.booking_purpose <> 'drinks'
      and t.booking_period_code is null
      and t.booking_type::text <> 'christmas'
  ),
  anchors as (
    select distinct on (q.customer_id) q.customer_id, q.booking_date, q.party_size, q.no_show
    from qualifying q
    order by q.customer_id, q.booking_date desc, q.booking_time desc
  ),
  visits as (
    select q.customer_id, count(*) filter (where not q.no_show)::integer as visit_count
    from qualifying q
    group by q.customer_id
  )
  select c.id, btrim(c.first_name), lower(btrim(c.email::text)), a.booking_date,
         extract(isodow from a.booking_date) = 7, a.no_show, least(greatest(a.party_size, 1), 20), coalesce(v.visit_count, 0)
  from anchors a
  join customers c on c.id = a.customer_id
  left join visits v on v.customer_id = a.customer_id
  where not c.is_placeholder
    and c.merged_into_customer_id is null
    and c.email is not null and btrim(c.email) <> ''
    and c.marketing_email_opted_out_at is null
    and coalesce(c.email_status, 'unknown') <> 'bounced'
    and not exists (
      select 1 from marketing_do_not_contact d
      where d.email_normalised = lower(btrim(c.email)) and d.removed_at is null)
    and not exists (
      select 1 from email_suppressions es where lower(es.email) = lower(btrim(c.email)))
    -- Any live booking after the anchor, past or future, means they came back or are coming.
    and not exists (
      select 1 from table_bookings later
      where later.customer_id = c.id
        and later.booking_date > a.booking_date
        and later.status::text <> 'cancelled')
    -- Sent the "did we miss you" email in the last 14 days: no offer on top of it yet. Any of
    -- their bookings counts, including a Christmas or drinks booking that never anchors.
    and not exists (
      select 1 from table_bookings missed
      where missed.customer_id = c.id
        and missed.no_show_follow_up_sent_at is not null
        and (missed.no_show_follow_up_sent_at at time zone 'Europe/London')::date > v_today - 14)
    and (
      (v_touch = 1 and (v_today - a.booking_date) between v_min and v_max)
      or (v_touch = 2 and exists (
        select 1
        from marketing_campaign_recipients r
        join vouchers vo on vo.id = r.voucher_id
        where r.campaign_id = v_previous
          and r.customer_id = c.id
          and r.status = 'sent'
          and r.lifecycle_anchor_date = a.booking_date
          and r.sent_at <= now() - make_interval(days => v_since_previous)
          and vo.status = 'expired'))
    );
end;
$function$;

revoke all on function public.get_table_return_visit_audience(jsonb, date) from public, anon, authenticated;
grant execute on function public.get_table_return_visit_audience(jsonb, date) to service_role;

commit;
