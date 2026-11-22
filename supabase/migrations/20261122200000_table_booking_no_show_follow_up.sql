-- No-show follow-up for table bookings (owner decisions A and B, 22 November 2026).
--
-- Additive and safe to apply before the code deploys: the app running today never reads the new
-- columns, never creates the new guest link type, and marks and undoes a no-show exactly as it
-- did. One behaviour changes for it: undoing a no-show now lowers the customer's no-show tally
-- (it used to stay raised for good).
--
--   1. table_bookings gains five nullable columns: the claim and send time of the morning-after
--      email, and the guest's reply to it. No default, so no table rewrite.
--   2. guest_tokens.action_type accepts 'no_show_follow_up', the link in that email. The list is
--      the live one (pg_get_constraintdef on 22 November 2026) plus the new value.
--   3. update_customer_booking_stats lowers customers.no_show_count when a booking stops being a
--      no-show, never below zero, and treats a missing tally as zero. Restated from
--      pg_get_functiondef on 22 November 2026: not SECURITY DEFINER, search_path public,
--      pg_catalog. CREATE OR REPLACE keeps its owner and grants, which are left as they are (it is
--      a trigger function and cannot be called directly).
--
-- Tested by scripts/testing/no-show-follow-up-postgres.py.
--
-- Rollback:
--   alter table public.table_bookings
--     drop constraint table_bookings_no_show_guest_response_ck,
--     drop constraint table_bookings_no_show_guest_reason_ck,
--     drop column no_show_follow_up_claimed_at, drop column no_show_follow_up_sent_at,
--     drop column no_show_guest_response, drop column no_show_guest_reason,
--     drop column no_show_guest_responded_at;
--   delete from public.guest_tokens where action_type = 'no_show_follow_up';
--   then restore guest_tokens_action_type_check without 'no_show_follow_up', drop
--   guest_tokens_no_show_follow_up_scope_check, and restore the function body from
--   20261027232415_customer_booking_counters_live.sql.

begin;

-- 1. The morning-after email and the guest's reply, kept on the booking.
alter table public.table_bookings
  add column no_show_follow_up_claimed_at timestamptz,
  add column no_show_follow_up_sent_at timestamptz,
  add column no_show_guest_response text,
  add column no_show_guest_reason text,
  add column no_show_guest_responded_at timestamptz;

alter table public.table_bookings
  add constraint table_bookings_no_show_guest_response_ck check (
    no_show_guest_response is null or no_show_guest_response in ('attended', 'could_not_make_it')
  ),
  add constraint table_bookings_no_show_guest_reason_ck check (
    no_show_guest_reason is null or char_length(no_show_guest_reason) <= 400
  );

comment on column public.table_bookings.no_show_follow_up_claimed_at is
  'Set before the morning-after no-show email is sent and never cleared, so a booking is emailed at most once.';
comment on column public.table_bookings.no_show_follow_up_sent_at is
  'When the morning-after no-show email was accepted for sending. Return-visit offers are held for 14 days after it.';
comment on column public.table_bookings.no_show_guest_response is
  'The guest''s reply to the no-show email: attended (they say they did come in) or could_not_make_it.';
comment on column public.table_bookings.no_show_guest_reason is
  'Why the guest could not make it, as "code" or "code: their words". Optional; null when they gave none.';

-- The return-visit audience asks "was this customer sent the email in the last 14 days".
create index table_bookings_no_show_follow_up_sent_idx
  on public.table_bookings (customer_id, no_show_follow_up_sent_at)
  where no_show_follow_up_sent_at is not null;

-- 2. The link in the email.
alter table public.guest_tokens
  drop constraint guest_tokens_action_type_check,
  add constraint guest_tokens_action_type_check check (
    action_type = any (array[
      'manage'::text, 'sunday_preorder'::text, 'card_capture'::text, 'payment'::text,
      'review_redirect'::text, 'charge_approval'::text, 'waitlist_offer'::text,
      'private_feedback'::text, 'private_booking_outcome'::text, 'booking_confirm'::text,
      'email_capture'::text, 'preorder_guest'::text, 'event_rebook'::text,
      'no_show_follow_up'::text
    ])
  ),
  add constraint guest_tokens_no_show_follow_up_scope_check check (
    action_type <> 'no_show_follow_up' or table_booking_id is not null
  );

-- 3. The no-show tally follows the booking both ways.
create or replace function public.update_customer_booking_stats()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $function$
BEGIN
  -- Table booking counts and dates are read from table_bookings when needed (BK-165); only the
  -- no-show tally is kept on the customer.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status != 'no_show' AND NEW.status = 'no_show' THEN
      UPDATE customers
      SET no_show_count = COALESCE(no_show_count, 0) + 1
      WHERE id = NEW.customer_id;
    ELSIF OLD.status = 'no_show' AND NEW.status != 'no_show' THEN
      -- A no-show put right (seated after all, marked confirmed, or the guest told us they did
      -- come in) comes off the tally. Never below zero: older undos never raised it back.
      UPDATE customers
      SET no_show_count = GREATEST(COALESCE(no_show_count, 0) - 1, 0)
      WHERE id = NEW.customer_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

commit;
