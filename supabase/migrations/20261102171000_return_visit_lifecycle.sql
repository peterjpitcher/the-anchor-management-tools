-- Return-visit emails with digital vouchers (spec tasks/spec-2026-11-02-table-booking-return-visits.md,
-- sections 7 and 9; voucher card design docs/design/email-handover/HANDOVER-voucher-card-nov-2026.md).
--
-- Additive only. Every existing campaign is kind 'one_off' and behaves exactly as before:
-- the one-off promotion and completion paths now say so explicitly, and the claim path changes
-- only for lifecycle campaigns. Functions replaced here restate SECURITY DEFINER, the pinned
-- search_path and their grants (service_role only), taken from pg_get_functiondef on
-- 2 November 2026.
--
-- Deviations from spec section 9.1, chosen because they touch less live code:
-- * voucher_generate_batch and voucher_issue are not changed. issue_lifecycle_voucher numbers and
--   issues its own voucher from the same monthly counter, in one transaction, with source 'system'.
-- * voucher_redeem is not changed. The discount given is written after a successful redemption
--   by the floor screen's server action (vouchers.redeemed_value_pence).
-- * A lifecycle recipient held back by the frequency cap is deferred, not skipped, so a round-up
--   sent the same week does not cost the guest their voucher for a year.

begin;

-- 1. Campaigns: a lifecycle campaign runs every send day instead of once.
alter table public.marketing_campaigns
  add column kind text not null default 'one_off',
  add column cooldown_days integer,
  add column send_days smallint[],
  add column promote_at_local time,
  add column last_promoted_on date,
  add column holdout_percent smallint not null default 0;

alter table public.marketing_campaigns
  add constraint marketing_campaigns_kind_check check (kind in ('one_off', 'lifecycle')),
  add constraint marketing_campaigns_holdout_percent_check check (holdout_percent between 0 and 50),
  add constraint marketing_campaigns_lifecycle_fields check (
    kind <> 'lifecycle' or (
      audience_type = 'customer'
      and cooldown_days is not null and cooldown_days between 1 and 730
      and send_days is not null and cardinality(send_days) between 1 and 7
      and send_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
      and promote_at_local is not null
      and jsonb_typeof(audience -> 'customer_filter') = 'object'
    )
  );

comment on column public.marketing_campaigns.kind is
  'one_off: one send to everyone eligible on scheduled_for. lifecycle: stays in sending and adds the day''s audience once per London send day.';
comment on column public.marketing_campaigns.send_days is
  'ISO weekdays (1 Monday to 7 Sunday) on which a lifecycle campaign promotes. London time.';
comment on column public.marketing_campaigns.holdout_percent is
  'Share of a lifecycle audience recorded as skipped with reason holdout and sent nothing, as the control group.';

-- 2. Recipients: per-recipient merge values, the issued voucher, and the visit that selected them.
alter table public.marketing_campaign_recipients
  add column merge_fields jsonb,
  add column voucher_id uuid references public.vouchers(id) on delete set null,
  add column lifecycle_anchor_date date;

alter table public.marketing_campaign_recipients
  drop constraint marketing_campaign_recipients_skip_reason_check,
  add constraint marketing_campaign_recipients_skip_reason_check check (
    skip_reason is null or skip_reason = any (array[
      'unsubscribed', 'suppressed', 'do_not_contact', 'frequency_cap', 'not_eligible',
      'campaign_cancelled', 'already_booked', 'booked_since_selection', 'holdout'
    ])
  );

-- A guest may come round a lifecycle campaign again after a new visit, so uniqueness is per
-- visit. For a one-off campaign the anchor is always null and NULLS NOT DISTINCT keeps the
-- old rule exactly: one row per customer per campaign.
create unique index mcr_campaign_customer_anchor_key
  on public.marketing_campaign_recipients (campaign_id, customer_id, lifecycle_anchor_date) nulls not distinct
  where customer_id is not null;
drop index public.mcr_campaign_customer_key;

create index mcr_voucher_idx on public.marketing_campaign_recipients (voucher_id) where voucher_id is not null;

-- 3. Vouchers: percentage types as data, digital batches, the campaign link and the real discount.
alter table public.voucher_types
  add column discount_kind text not null default 'fixed',
  add column percent_off smallint,
  add column digital_only boolean not null default false;

alter table public.voucher_types
  add constraint voucher_types_discount_kind_check check (discount_kind in ('fixed', 'percent')),
  add constraint voucher_types_percent_off_check check (
    (discount_kind = 'percent' and percent_off is not null and percent_off between 1 and 100)
    or (discount_kind = 'fixed' and percent_off is null)
  );

alter table public.voucher_batches
  add column digital boolean not null default false,
  add column marketing_campaign_id uuid references public.marketing_campaigns(id) on delete set null;

create index voucher_batches_campaign_idx on public.voucher_batches (marketing_campaign_id)
  where marketing_campaign_id is not null;

alter table public.vouchers
  add column marketing_recipient_id uuid unique references public.marketing_campaign_recipients(id) on delete set null,
  add column redeemed_value_pence integer;

alter table public.vouchers
  add constraint vouchers_redeemed_value_pence_check check (redeemed_value_pence is null or redeemed_value_pence between 0 and 1000000);

comment on column public.vouchers.redeemed_value_pence is
  'The discount actually given at the till, entered on the floor screen. Cash-up prefers it to value_pence, which is an estimate.';

-- value_pence is an internal liability estimate, never shown to a guest (owner decision B,
-- 2 November 2026): about 55 pounds of food a table, so 6 pounds and 14 pounds.
insert into public.voucher_types
  (id, display_title, cover_title, value_pence, requires_booking, alcohol, entitlement_html, hero, copy,
   sort_order, active, discount_kind, percent_off, digital_only)
values
  ('return-10', '10% OFF YOUR FOOD', '10% off your food', 600, true, false,
   '<p>This voucher gives 10% off the food bill for the booked table, in one visit and one transaction.</p><p>Drinks are not included. It is not valid against the Christmas menu or any special occasion menu.</p><p>Advance booking is required. One voucher per table, and it cannot be used with any other offer. Show the email at the bar so the voucher number can be read.</p>',
   '{"kind": "word", "big": "10% off", "sub": "your food"}'::jsonb,
   '{"open": "Your voucher", "aside": "Ten per cent off the food for your table.", "prize": "10% off your food", "script": "Come back and see us", "headline": "A table is waiting", "community": "There is always room at the table."}'::jsonb,
   10, true, 'percent', 10, true),
  ('return-25', '25% OFF YOUR FOOD', '25% off your food', 1400, true, false,
   '<p>This voucher gives 25% off the food bill for the booked table, in one visit and one transaction.</p><p>Drinks are not included. It is not valid against the Christmas menu or any special occasion menu.</p><p>Advance booking is required. One voucher per table, and it cannot be used with any other offer. Show the email at the bar so the voucher number can be read.</p>',
   '{"kind": "word", "big": "25% off", "sub": "your food"}'::jsonb,
   '{"open": "Your voucher", "aside": "A quarter off the food for your table.", "prize": "25% off your food", "script": "Come back and see us", "headline": "A table is waiting", "community": "There is always room at the table."}'::jsonb,
   11, true, 'percent', 25, true);

-- 4. Attribution: a table booking made from a campaign link.
alter table public.marketing_conversions
  drop constraint marketing_conversions_conversion_type_check,
  add constraint marketing_conversions_conversion_type_check check (
    conversion_type = any (array['christmas_enquiry', 'private_booking_enquiry', 'contact_form', 'other', 'table_booking'])
  );

create unique index marketing_conversions_table_booking_key
  on public.marketing_conversions ((metadata ->> 'table_booking_id'))
  where conversion_type = 'table_booking';

-- 5. The audience. One definition of a visit, shared by both touches and by the stats.
--    A visit is a table booking dated before today with status completed, confirmed,
--    visited_waiting_for_review or review_clicked (spec section 2). A no-show anchors too
--    (owner decision 4). Venue events, drinks-only and Christmas bookings never anchor.
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

-- 6. Promotion. One-off campaigns unchanged apart from saying they are one-off; lifecycle
--    campaigns add the day's audience once per London send day after promote_at_local.
create or replace function public.promote_due_marketing_campaigns()
returns table(promoted_campaign_id uuid, promoted_recipients integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_campaign public.marketing_campaigns%ROWTYPE;
  v_include text[];
  v_exclude text[];
  v_added integer;
  v_london timestamp := now() at time zone 'Europe/London';
  v_today date := (now() at time zone 'Europe/London')::date;
BEGIN
  FOR v_campaign IN
    SELECT * FROM public.marketing_campaigns
    WHERE status = 'scheduled' AND scheduled_for <= now() AND kind = 'one_off'
    ORDER BY scheduled_for
    FOR UPDATE SKIP LOCKED
  LOOP
    CONTINUE WHEN NOT public.marketing_send_window_open(v_campaign.audience_type);

    v_include := COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(v_campaign.audience -> 'include_tags')), '{}'::text[]);
    v_exclude := COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(v_campaign.audience -> 'exclude_tags')), '{}'::text[]);

    IF v_campaign.audience_type = 'customer' THEN
      INSERT INTO public.marketing_campaign_recipients AS r (campaign_id, customer_id, email)
      SELECT v_campaign.id, c.id, lower(btrim(c.email))
      FROM public.customers c
      WHERE c.email IS NOT NULL AND btrim(c.email) <> ''
        AND c.marketing_email_opted_out_at IS NULL
        AND COALESCE(c.email_status, 'unknown') <> 'bounced'
        AND (
          c.marketing_email_opt_in IS TRUE
          OR EXISTS (SELECT 1 FROM public.bookings b WHERE b.customer_id = c.id)
          OR EXISTS (SELECT 1 FROM public.table_bookings t WHERE t.customer_id = c.id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.marketing_do_not_contact d
          WHERE d.email_normalised = lower(btrim(c.email)) AND d.removed_at IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM public.email_suppressions es WHERE lower(es.email) = lower(btrim(c.email)))
      ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO public.marketing_campaign_recipients AS r (campaign_id, contact_id, email)
      SELECT v_campaign.id, bc.id, bc.email
      FROM public.business_contacts bc
      WHERE bc.eligibility_status = 'eligible'
        AND bc.marketing_status = 'subscribed'
        AND (cardinality(v_include) = 0 OR bc.tags && v_include)
        AND (cardinality(v_exclude) = 0 OR NOT (bc.tags && v_exclude))
        AND NOT EXISTS (
          SELECT 1 FROM public.marketing_do_not_contact d
          WHERE d.email_normalised = bc.email AND d.removed_at IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM public.email_suppressions es WHERE lower(es.email) = bc.email)
      ON CONFLICT DO NOTHING;
    END IF;

    GET DIAGNOSTICS v_added = ROW_COUNT;

    UPDATE public.marketing_campaigns
       SET status = CASE WHEN v_added = 0 THEN 'completed' ELSE 'sending' END,
           started_at = now(),
           completed_at = CASE WHEN v_added = 0 THEN now() ELSE NULL END
     WHERE id = v_campaign.id;

    promoted_campaign_id := v_campaign.id;
    promoted_recipients := v_added;
    RETURN NEXT;
  END LOOP;

  FOR v_campaign IN
    SELECT * FROM public.marketing_campaigns
    WHERE kind = 'lifecycle'
      AND status = 'sending'
      AND last_promoted_on IS DISTINCT FROM v_today
      AND extract(isodow FROM v_today)::smallint = ANY (send_days)
      AND v_london::time >= promote_at_local
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
  LOOP
    CONTINUE WHEN NOT public.marketing_send_window_open(v_campaign.audience_type);

    INSERT INTO public.marketing_campaign_recipients AS r
      (campaign_id, customer_id, email, status, skip_reason, lifecycle_anchor_date, merge_fields)
    SELECT v_campaign.id, a.customer_id, a.email,
           CASE WHEN h.held_out THEN 'skipped' ELSE 'pending' END,
           CASE WHEN h.held_out THEN 'holdout' END,
           a.anchor_date,
           jsonb_build_object('first_name', a.first_name, 'party_size', a.last_party_size)
    FROM public.get_table_return_visit_audience(v_campaign.audience -> 'customer_filter', v_today) a
    -- A stable hash of the customer, so the same guest is always in or out of the control group.
    CROSS JOIN LATERAL (
      SELECT ((hashtext(a.customer_id::text)::bigint % 100 + 100) % 100) < v_campaign.holdout_percent AS held_out
    ) h
    WHERE NOT EXISTS (
        -- Once per cooldown in this campaign. A frequency-capped deferral is still pending,
        -- and a booked_since_selection skip means they came back, so neither blocks re-entry.
        SELECT 1 FROM public.marketing_campaign_recipients prior
        WHERE prior.campaign_id = v_campaign.id
          AND prior.customer_id = a.customer_id
          AND prior.created_at > now() - make_interval(days => v_campaign.cooldown_days)
          AND (prior.status <> 'skipped' OR prior.skip_reason = 'holdout'))
      AND NOT EXISTS (
        -- Never more than one lifecycle email in 30 days, however the rules overlap. A holdout
        -- row counts too, or another lifecycle campaign would email the control group.
        SELECT 1 FROM public.marketing_campaign_recipients other
        JOIN public.marketing_campaigns oc ON oc.id = other.campaign_id
        WHERE oc.kind = 'lifecycle'
          AND other.customer_id = a.customer_id
          AND (other.status IN ('pending', 'sending', 'sent', 'needs_review') OR other.skip_reason = 'holdout')
          AND other.created_at > now() - interval '30 days')
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_added = ROW_COUNT;

    UPDATE public.marketing_campaigns
       SET last_promoted_on = v_today,
           started_at = COALESCE(started_at, now())
     WHERE id = v_campaign.id;

    promoted_campaign_id := v_campaign.id;
    promoted_recipients := v_added;
    RETURN NEXT;
  END LOOP;
END;
$function$;

revoke all on function public.promote_due_marketing_campaigns() from public, anon, authenticated;
grant execute on function public.promote_due_marketing_campaigns() to service_role;

-- 7. Completion: a lifecycle campaign never completes on its own; it is paused or cancelled.
create or replace function public.complete_finished_marketing_campaigns()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_completed integer;
BEGIN
  UPDATE public.marketing_campaigns c
     SET status = 'completed', completed_at = now()
   WHERE c.status = 'sending'
     AND c.kind = 'one_off'
     AND NOT EXISTS (
       SELECT 1 FROM public.marketing_campaign_recipients r
       WHERE r.campaign_id = c.id AND r.status IN ('pending', 'sending')
     );

  GET DIAGNOSTICS v_completed = ROW_COUNT;
  RETURN v_completed;
END;
$function$;

revoke all on function public.complete_finished_marketing_campaigns() from public, anon, authenticated;
grant execute on function public.complete_finished_marketing_campaigns() to service_role;

-- 8. Claim: two lifecycle-only changes. A guest who has booked since they were selected is
--    skipped before any voucher exists, and the frequency cap defers rather than skips.
create or replace function public.claim_marketing_recipients(p_batch integer)
returns setof marketing_campaign_recipients
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_settings public.marketing_settings%ROWTYPE;
  v_candidate record;
  v_contact public.business_contacts%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_row public.marketing_campaign_recipients%ROWTYPE;
  v_claimed integer := 0;
  v_lease interval := interval '10 minutes';
  v_skip text;
  v_email text;
  v_last timestamptz;
  v_reserved timestamptz;
BEGIN
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 200 THEN
    RAISE EXCEPTION 'claim_marketing_recipients: p_batch must be between 1 and 200, got %', p_batch;
  END IF;

  SELECT * INTO v_settings FROM public.marketing_settings WHERE id LIMIT 1;
  IF NOT FOUND OR NOT v_settings.sends_enabled THEN RETURN; END IF;

  FOR v_candidate IN
    SELECT r.id AS recipient_id, r.contact_id, r.customer_id, r.failure_class, r.last_attempt_at,
           r.lifecycle_anchor_date, c.kind, c.ignores_frequency_cap, c.event_id
    FROM public.marketing_campaign_recipients r
    JOIN public.marketing_campaigns c ON c.id = r.campaign_id
    WHERE r.status = 'pending'
      AND c.status = 'sending'
      AND public.marketing_send_window_open(c.audience_type)
      AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())
    ORDER BY r.created_at
    LIMIT GREATEST(p_batch * 4, 20)
  LOOP
    EXIT WHEN v_claimed >= p_batch;

    IF v_candidate.failure_class = 'unknown'
       AND v_candidate.last_attempt_at IS NOT NULL
       AND v_candidate.last_attempt_at < now() - interval '24 hours' THEN
      UPDATE public.marketing_campaign_recipients
         SET status = 'needs_review',
             error = 'Recovered from an attempt whose outcome could not be proved, and the provider idempotency window has since closed'
       WHERE id = v_candidate.recipient_id AND status = 'pending';
      CONTINUE;
    END IF;

    v_skip := NULL;

    IF v_candidate.customer_id IS NOT NULL THEN
      SELECT * INTO v_customer FROM public.customers
       WHERE id = v_candidate.customer_id FOR UPDATE SKIP LOCKED;
      CONTINUE WHEN NOT FOUND;

      v_email := lower(btrim(COALESCE(v_customer.email, '')));
      v_last := v_customer.marketing_last_email_at;
      v_reserved := v_customer.marketing_reserved_until;

      IF v_email = '' THEN
        v_skip := 'not_eligible';
      ELSIF v_customer.marketing_email_opted_out_at IS NOT NULL THEN
        v_skip := 'unsubscribed';
      ELSIF COALESCE(v_customer.email_status, 'unknown') = 'bounced' THEN
        v_skip := 'suppressed';
      ELSIF NOT (
        v_customer.marketing_email_opt_in IS TRUE
        OR EXISTS (SELECT 1 FROM public.bookings b WHERE b.customer_id = v_customer.id)
        OR EXISTS (SELECT 1 FROM public.table_bookings t WHERE t.customer_id = v_customer.id)
      ) THEN
        v_skip := 'not_eligible';
      END IF;
    ELSE
      SELECT * INTO v_contact FROM public.business_contacts
       WHERE id = v_candidate.contact_id FOR UPDATE SKIP LOCKED;
      CONTINUE WHEN NOT FOUND;

      v_email := v_contact.email;
      v_last := v_contact.last_marketing_email_at;
      v_reserved := v_contact.marketing_reserved_until;

      IF v_contact.eligibility_status <> 'eligible' THEN
        v_skip := 'not_eligible';
      ELSIF v_contact.marketing_status <> 'subscribed' THEN
        v_skip := 'unsubscribed';
      END IF;
    END IF;

    IF v_skip IS NULL AND EXISTS (
      SELECT 1 FROM public.marketing_do_not_contact d
      WHERE d.email_normalised = v_email AND d.removed_at IS NULL
    ) THEN
      v_skip := 'do_not_contact';
    END IF;

    -- A guest who already holds seats for the event this campaign promotes is not asked to
    -- book it. Read here, at the moment of sending, so a booking made minutes earlier counts.
    -- Business contacts have no bookings of their own and are never skipped by this.
    IF v_skip IS NULL
       AND v_candidate.customer_id IS NOT NULL
       AND v_candidate.event_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.bookings b
          WHERE b.event_id = v_candidate.event_id
            AND b.customer_id = v_candidate.customer_id
            AND b.status NOT IN ('cancelled', 'expired')
       ) THEN
      v_skip := 'already_booked';
    END IF;

    -- Lifecycle only: a table booking after the visit that selected them means they are coming
    -- back anyway. Checked before the voucher is issued, so a skipped guest never gets one.
    IF v_skip IS NULL
       AND v_candidate.kind = 'lifecycle'
       AND v_candidate.customer_id IS NOT NULL
       AND v_candidate.lifecycle_anchor_date IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.table_bookings t
          WHERE t.customer_id = v_candidate.customer_id
            AND t.booking_date > v_candidate.lifecycle_anchor_date
            AND t.status::text <> 'cancelled'
       ) THEN
      v_skip := 'booked_since_selection';
    END IF;

    IF v_skip IS NULL AND NOT COALESCE(v_candidate.ignores_frequency_cap, false)
       AND v_settings.frequency_cap_days > 0
       AND v_last IS NOT NULL
       AND v_last > now() - make_interval(days => v_settings.frequency_cap_days) THEN
      IF v_candidate.kind = 'lifecycle' THEN
        -- Wait out the cap instead of losing the voucher for a year.
        UPDATE public.marketing_campaign_recipients
           SET next_attempt_at = v_last + make_interval(days => v_settings.frequency_cap_days)
         WHERE id = v_candidate.recipient_id AND status = 'pending';
        CONTINUE;
      END IF;
      v_skip := 'frequency_cap';
    END IF;

    IF v_skip IS NOT NULL THEN
      UPDATE public.marketing_campaign_recipients
         SET status = 'skipped', skip_reason = v_skip
       WHERE id = v_candidate.recipient_id AND status = 'pending';
      CONTINUE;
    END IF;

    CONTINUE WHEN v_reserved IS NOT NULL AND v_reserved > now();

    IF v_candidate.customer_id IS NOT NULL THEN
      UPDATE public.customers SET marketing_reserved_until = now() + v_lease
       WHERE id = v_candidate.customer_id;
    ELSE
      UPDATE public.business_contacts SET marketing_reserved_until = now() + v_lease
       WHERE id = v_candidate.contact_id;
    END IF;

    UPDATE public.marketing_campaign_recipients
       SET status = 'sending', claimed_at = now(), lease_expires_at = now() + v_lease,
           attempt_count = attempt_count + 1, last_attempt_at = now()
     WHERE id = v_candidate.recipient_id AND status = 'pending'
    RETURNING * INTO v_row;

    CONTINUE WHEN NOT FOUND;

    v_claimed := v_claimed + 1;
    RETURN NEXT v_row;
  END LOOP;
END;
$function$;

revoke all on function public.claim_marketing_recipients(integer) from public, anon, authenticated;
grant execute on function public.claim_marketing_recipients(integer) to service_role;

-- 9. Reminders: a voucher sent by email gets the 3-day reminder only (owner decision C).
create or replace function public.voucher_reminders_recompute(p_voucher_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row vouchers%rowtype;
  v_today date;
  v_locked text[];
  v_pending integer := 0;
  v_skipped integer := 0;
  v_kind text;
  v_date date;
begin
  select * into v_row from vouchers where id = p_voucher_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'NOT_FOUND');
  end if;

  if v_row.status <> 'issued' or v_row.customer_id is null or v_row.expiry_date is null then
    update voucher_reminders set status = 'cancelled'
    where voucher_id = p_voucher_id and status = 'pending';
    return jsonb_build_object('success', true, 'pending', 0);
  end if;

  v_today := (now() at time zone 'Europe/London')::date;

  -- Only a delivered or exhausted milestone is immutable. 'skipped' is not:
  -- it was never sent, so a later expiry change may legitimately revive it.
  select coalesce(array_agg(reminder_kind), '{}') into v_locked
  from voucher_reminders
  where voucher_id = p_voucher_id and status in ('sent', 'failed');

  -- Recomputable rows are replaced wholesale; skipped rows are updated in place
  -- below so their history is preserved rather than deleted and recreated.
  delete from voucher_reminders
  where voucher_id = p_voucher_id and status in ('pending', 'cancelled');

  for v_kind, v_date in
    select m.kind, m.target_date from (values
      ('pre_expiry_7'::text, v_row.expiry_date - 7),
      ('pre_expiry_3'::text, v_row.expiry_date - 3)
    ) as m(kind, target_date)
    -- A voucher issued by a return-visit email gets the 3-day reminder only.
    where v_row.marketing_recipient_id is null or m.kind = 'pre_expiry_3'
    order by m.target_date
  loop
    continue when v_kind = any(v_locked);

    if v_date < v_today then
      insert into voucher_reminders (voucher_id, customer_id, reminder_kind, status, scheduled_for)
      values (p_voucher_id, v_row.customer_id, v_kind, 'skipped', v_date)
      on conflict (voucher_id, reminder_kind) do update
        set scheduled_for = excluded.scheduled_for,
            customer_id = excluded.customer_id,
            status = 'skipped',
            updated_at = now()
        where voucher_reminders.status = 'skipped';
      v_skipped := v_skipped + 1;
    else
      insert into voucher_reminders (voucher_id, customer_id, reminder_kind, status, scheduled_for)
      values (p_voucher_id, v_row.customer_id, v_kind, 'pending', v_date)
      on conflict (voucher_id, reminder_kind) do update
        set scheduled_for = excluded.scheduled_for,
            customer_id = excluded.customer_id,
            status = 'pending',
            attempts = 0,
            last_error = null,
            channel = null,
            updated_at = now()
        where voucher_reminders.status = 'skipped';
      v_pending := v_pending + 1;
    end if;
  end loop;

  return jsonb_build_object('success', true, 'pending', v_pending, 'skipped', v_skipped);
end;
$function$;

revoke all on function public.voucher_reminders_recompute(uuid) from public, anon, authenticated;
grant execute on function public.voucher_reminders_recompute(uuid) to service_role;

-- 10. Issue one digital voucher to a claimed lifecycle recipient, in one transaction.
--     Idempotent: a retry for the same recipient returns the voucher it already has, so a
--     crashed send can never issue two.
create or replace function public.issue_lifecycle_voucher(p_recipient_id uuid, p_london_today date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := coalesce(p_london_today, (now() at time zone 'Europe/London')::date);
  v_recipient marketing_campaign_recipients%rowtype;
  v_campaign marketing_campaigns%rowtype;
  v_type voucher_types%rowtype;
  v_existing vouchers%rowtype;
  v_voucher vouchers%rowtype;
  v_filter jsonb;
  v_type_id text;
  v_valid_days integer;
  v_touch integer;
  v_terms text;
  v_batch_id uuid;
  v_month_key text;
  v_seq integer;
  v_number text;
  v_actor constant text := 'Return visit email';
begin
  select * into v_recipient from marketing_campaign_recipients where id = p_recipient_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'NOT_FOUND');
  end if;

  if v_recipient.voucher_id is not null then
    select * into v_existing from vouchers where id = v_recipient.voucher_id;
    return jsonb_build_object('success', true, 'idempotent_replay', true,
      'voucher_id', v_existing.id, 'voucher_number', v_existing.voucher_number,
      'voucher_status', v_existing.status, 'expiry_date', v_existing.expiry_date,
      'merge_fields', v_recipient.merge_fields);
  end if;

  if v_recipient.status <> 'sending' or v_recipient.customer_id is null then
    return jsonb_build_object('success', false, 'error_code', 'NOT_CLAIMED');
  end if;

  select * into v_campaign from marketing_campaigns where id = v_recipient.campaign_id;
  v_filter := v_campaign.audience -> 'customer_filter';
  if v_campaign.kind <> 'lifecycle' or v_filter is null then
    return jsonb_build_object('success', false, 'error_code', 'NOT_LIFECYCLE');
  end if;

  v_type_id := v_filter ->> 'voucher_type_id';
  v_valid_days := coalesce((v_filter ->> 'voucher_valid_days')::integer, 30);
  v_touch := coalesce((v_filter ->> 'touch')::integer, 1);
  if v_type_id is null then
    return jsonb_build_object('success', false, 'error_code', 'NO_VOUCHER');
  end if;
  if v_valid_days < 7 or v_valid_days > 90 then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'voucher_valid_days must be 7 to 90');
  end if;

  select * into v_type from voucher_types where id = v_type_id;
  if not found or not v_type.active or v_type.discount_kind <> 'percent' then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', format('voucher type %s is not an active percentage type', v_type_id));
  end if;

  select version into v_terms from terms_versions order by effective_from desc, created_at desc limit 1;
  if v_terms is null then
    raise exception 'No terms version is seeded; cannot issue vouchers';
  end if;

  -- One digital batch per campaign per London day, as the ledger groups printed batches.
  perform pg_advisory_xact_lock(hashtext('lifecycle-voucher-batch:' || v_campaign.id::text));
  select id into v_batch_id from voucher_batches
  where digital and marketing_campaign_id = v_campaign.id
    and (created_at at time zone 'Europe/London')::date = v_today
  order by created_at
  limit 1;

  if v_batch_id is null then
    insert into voucher_batches (created_by, created_by_name, note, terms_version, type_definitions,
                                 total_count, pdf_status, digital, marketing_campaign_id)
    values (null, v_actor,
            format('Return visit email, touch %s, %s', v_touch, to_char(v_today, 'FMDD FMMonth YYYY')),
            v_terms, jsonb_build_object(v_type.id, to_jsonb(v_type)), 0, 'ready', true, v_campaign.id)
    returning id into v_batch_id;
  end if;

  v_month_key := to_char(now() at time zone 'Europe/London', 'YYMM');
  insert into voucher_number_counters (month_key, last_seq)
  values (v_month_key, 1)
  on conflict (month_key) do update set last_seq = voucher_number_counters.last_seq + 1
  returning last_seq into v_seq;
  if v_seq > 9999 then
    raise exception 'Voucher numbers exhausted for month % (maximum 9999)', v_month_key;
  end if;
  v_number := 'AN-' || v_month_key || '-' || lpad(v_seq::text, 4, '0');

  insert into vouchers (voucher_number, type_id, batch_id, status, value_pence, terms_version,
                        issued_at, issued_by, issued_by_name, won_at_label, expiry_date,
                        customer_id, marketing_recipient_id)
  values (v_number, v_type.id, v_batch_id, 'issued', v_type.value_pence, v_terms,
          now(), null, v_actor, format('Come back offer, touch %s', v_touch), v_today + v_valid_days,
          v_recipient.customer_id, v_recipient.id)
  returning * into v_voucher;

  update voucher_batches set total_count = total_count + 1 where id = v_batch_id;

  insert into voucher_events (voucher_id, action, actor_name, source, detail) values
    (v_voucher.id, 'generated', v_actor, 'system',
     jsonb_build_object('batch_id', v_batch_id, 'voucher_number', v_number)),
    (v_voucher.id, 'issued', v_actor, 'system',
     jsonb_build_object('won_at_label', v_voucher.won_at_label, 'expiry_date', v_voucher.expiry_date,
                        'customer_id', v_recipient.customer_id, 'marketing_campaign_id', v_campaign.id,
                        'marketing_recipient_id', v_recipient.id));

  perform voucher_reminders_recompute(v_voucher.id);

  update marketing_campaign_recipients
     set voucher_id = v_voucher.id,
         merge_fields = coalesce(merge_fields, '{}'::jsonb) || jsonb_build_object(
           'voucher_number', v_number,
           'voucher_percent', v_type.percent_off,
           'voucher_expires_on', v_voucher.expiry_date)
   where id = v_recipient.id
  returning * into v_recipient;

  return jsonb_build_object('success', true, 'idempotent_replay', false,
    'voucher_id', v_voucher.id, 'voucher_number', v_number, 'voucher_status', v_voucher.status,
    'expiry_date', v_voucher.expiry_date, 'merge_fields', v_recipient.merge_fields);
end;
$function$;

revoke all on function public.issue_lifecycle_voucher(uuid, date) from public, anon, authenticated;
grant execute on function public.issue_lifecycle_voucher(uuid, date) to service_role;

-- 11. Measurement for the campaign page: per lifecycle campaign, the sent group against the
--     holdout. "Attributed" bookings carry this recipient's id in utm_content; "loose" bookings
--     are any new table booking by that guest. Both counted from the moment of selection.
create or replace function public.get_lifecycle_campaign_stats(p_campaign_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with recipients as (
    select r.id, r.customer_id, r.status, r.skip_reason, r.created_at, r.sent_at, r.voucher_id
    from marketing_campaign_recipients r
    where r.campaign_id = p_campaign_id and r.customer_id is not null
  ),
  groups as (
    select r.*,
      case when r.status = 'sent' then 'sent'
           when r.status = 'skipped' and r.skip_reason = 'holdout' then 'holdout' end as grp,
      coalesce(r.sent_at, r.created_at) as since
    from recipients r
  ),
  booked as (
    select g.id, g.grp,
      exists (select 1 from table_bookings t where t.customer_id = g.customer_id and t.status::text <> 'cancelled'
              and t.created_at > g.since and t.created_at <= g.since + interval '30 days') as within_30,
      exists (select 1 from table_bookings t where t.customer_id = g.customer_id and t.status::text <> 'cancelled'
              and t.created_at > g.since and t.created_at <= g.since + interval '90 days') as within_90,
      exists (select 1 from analytics_events e where e.event_type = 'table_booking_created'
              and e.metadata ->> 'utm_content' = g.id::text) as attributed,
      g.since <= now() - interval '30 days' as matured_30,
      g.since <= now() - interval '90 days' as matured_90
    from groups g where g.grp is not null
  )
  select jsonb_build_object(
    'selected', (select count(*) from recipients),
    'sent', (select count(*) from recipients where status = 'sent'),
    'holdout', (select count(*) from recipients where status = 'skipped' and skip_reason = 'holdout'),
    'booked_since_selection', (select count(*) from recipients where skip_reason = 'booked_since_selection'),
    'vouchers_issued', (select count(*) from recipients where voucher_id is not null),
    'vouchers_redeemed', (select count(*) from recipients r join vouchers v on v.id = r.voucher_id where v.status = 'redeemed'),
    'discount_given_pence', (select coalesce(sum(v.redeemed_value_pence), 0) from recipients r join vouchers v on v.id = r.voucher_id where v.status = 'redeemed'),
    'attributed_bookings', (select count(*) from booked where grp = 'sent' and attributed),
    'sent_matured_30', (select count(*) from booked where grp = 'sent' and matured_30),
    'sent_booked_30', (select count(*) from booked where grp = 'sent' and matured_30 and within_30),
    'sent_matured_90', (select count(*) from booked where grp = 'sent' and matured_90),
    'sent_booked_90', (select count(*) from booked where grp = 'sent' and matured_90 and within_90),
    'holdout_matured_30', (select count(*) from booked where grp = 'holdout' and matured_30),
    'holdout_booked_30', (select count(*) from booked where grp = 'holdout' and matured_30 and within_30),
    'holdout_matured_90', (select count(*) from booked where grp = 'holdout' and matured_90),
    'holdout_booked_90', (select count(*) from booked where grp = 'holdout' and matured_90 and within_90)
  );
$function$;

revoke all on function public.get_lifecycle_campaign_stats(uuid) from public, anon, authenticated;
grant execute on function public.get_lifecycle_campaign_stats(uuid) to service_role;

commit;
