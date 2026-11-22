#!/usr/bin/env python3
"""Test the three no-show follow-up migrations in a disposable local Postgres.

Hand-written tables holding the columns the functions and constraints read, a Unix socket with no
network listener, and the two functions loaded as production holds them before the change: the
no-show tally trigger (pg_get_functiondef on 22 November 2026) and the return-visit audience
(section 5 of 20261102210508_return_visit_lifecycle.sql, which production's body matches). The
REAL migration files are then applied on top. Dates are built from the London date, so the run is
the same in any zone.

Covers: the new booking columns and their checks; the new guest link type and its scope; the tally
going up on a no-show and coming back down on any undo, never below zero, with a missing tally
treated as zero; the audience unchanged for everyone not emailed, held for 14 days after the email
and released on day 14; the functions keeping their security settings and grants; and the flag
merging into the existing settings row without touching another flag.
"""
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
MIGRATIONS = ROOT / 'supabase/migrations'
SCHEMA_MIGRATION = MIGRATIONS / '20261122200000_table_booking_no_show_follow_up.sql'
AUDIENCE_MIGRATION = MIGRATIONS / '20261122200100_return_visit_hold_after_no_show_email.sql'
FLAG_MIGRATION = MIGRATIONS / '20261122200200_table_no_show_follow_up_flag_on.sql'
RETURN_VISIT_MIGRATION = MIGRATIONS / '20261102210508_return_visit_lifecycle.sql'

SCHEMA = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION fixture_assert(boolean, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %', $2; END IF; RAISE NOTICE 'PASS %', $2; END $$;
CREATE FUNCTION london_today() RETURNS date LANGUAGE sql AS $$ SELECT (now() AT TIME ZONE 'Europe/London')::date $$;
-- Noon London on the day n days ago, as an instant: clear of midnight in every zone.
CREATE FUNCTION london_noon_days_ago(n integer) RETURNS timestamptz LANGUAGE sql AS
 $$ SELECT ((london_today() - n) + time '12:00') AT TIME ZONE 'Europe/London' $$;

CREATE TABLE public.customers (
  id uuid PRIMARY KEY, first_name text NOT NULL, email varchar, email_status text DEFAULT 'unknown',
  marketing_email_opted_out_at timestamptz, is_placeholder boolean NOT NULL DEFAULT false,
  merged_into_customer_id uuid, no_show_count integer DEFAULT 0);
CREATE TABLE public.table_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid REFERENCES customers, booking_date date NOT NULL,
  booking_time time NOT NULL DEFAULT '19:00', party_size integer NOT NULL DEFAULT 4,
  booking_type text NOT NULL DEFAULT 'regular', status text NOT NULL DEFAULT 'confirmed',
  booking_purpose text NOT NULL DEFAULT 'food', is_venue_event boolean NOT NULL DEFAULT false,
  booking_period_code text);
CREATE TABLE public.guest_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hashed_token text NOT NULL UNIQUE, customer_id uuid NOT NULL,
  table_booking_id uuid REFERENCES table_bookings ON DELETE CASCADE, action_type text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  CONSTRAINT guest_tokens_action_type_check CHECK (action_type = ANY (ARRAY['manage'::text, 'sunday_preorder'::text,
    'card_capture'::text, 'payment'::text, 'review_redirect'::text, 'charge_approval'::text, 'waitlist_offer'::text,
    'private_feedback'::text, 'private_booking_outcome'::text, 'booking_confirm'::text, 'email_capture'::text,
    'preorder_guest'::text, 'event_rebook'::text])));
CREATE TABLE public.marketing_do_not_contact (email_normalised text, removed_at timestamptz);
CREATE TABLE public.email_suppressions (email text);
CREATE TABLE public.vouchers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text);
CREATE TABLE public.marketing_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid, customer_id uuid, status text,
  lifecycle_anchor_date date, sent_at timestamptz, voucher_id uuid);
CREATE TABLE public.system_settings (key text PRIMARY KEY, value jsonb NOT NULL);

-- The tally trigger as production holds it before this change.
CREATE FUNCTION public.update_customer_booking_stats() RETURNS trigger LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog' AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status != 'no_show' AND NEW.status = 'no_show' THEN
      UPDATE customers
      SET no_show_count = no_show_count + 1
      WHERE id = NEW.customer_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.update_customer_booking_stats() TO PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER update_customer_stats_on_booking AFTER INSERT OR UPDATE ON public.table_bookings
  FOR EACH ROW EXECUTE FUNCTION update_customer_booking_stats();
"""


def cust(n):
    return f"'a0000000-0000-0000-0000-{n:012d}'"


def booking(n):
    return f"'b0000000-0000-0000-0000-{n:012d}'"


# The filter with a one-day minimum, so a recent no-show can anchor and the hold is what decides.
RECENT_FILTER = '{"rule": "table_return_visit", "touch": 1, "include_no_shows": true, "days_since_anchor_min": 1, "days_since_anchor_max": 180}'
# Production's touch 1 filter.
LIVE_FILTER = '{"rule": "table_return_visit", "touch": 1, "include_no_shows": true, "days_since_anchor_min": 45, "days_since_anchor_max": 180}'

SEED = f"""
INSERT INTO customers (id, first_name, email) VALUES
 ({cust(1)}, 'Sam', 'sam@example.test'),   -- visit 50 days ago
 ({cust(2)}, 'Pat', 'pat@example.test'),   -- no-show 5 days ago
 ({cust(3)}, 'Lou', 'lou@example.test'),   -- no-show 15 days ago
 ({cust(4)}, 'Kim', 'kim@example.test'),   -- visit 50 days ago, and a cancelled Christmas table 3 days ago
 ({cust(5)}, 'Ali', 'ali@example.test');   -- the tally fixture
INSERT INTO table_bookings (id, customer_id, booking_date, status, booking_type) VALUES
 ({booking(1)}, {cust(1)}, london_today() - 50, 'completed', 'regular'),
 ({booking(2)}, {cust(2)}, london_today() - 5, 'no_show', 'regular'),
 ({booking(3)}, {cust(3)}, london_today() - 15, 'no_show', 'regular'),
 ({booking(4)}, {cust(4)}, london_today() - 50, 'completed', 'regular'),
 ({booking(5)}, {cust(4)}, london_today() - 3, 'cancelled', 'christmas'),
 ({booking(6)}, {cust(5)}, london_today(), 'confirmed', 'regular');  -- today, so it never anchors
INSERT INTO system_settings (key, value) VALUES
 ('messaging_flags', '{{"bounce_sms_fallback": true, "event_promo_intro_sms_no_email": false}}');
"""


def baseline_audience_sql():
    """Section 5 of the return-visit migration: the audience function and its grants."""
    text = RETURN_VISIT_MIGRATION.read_text()
    match = re.search(
        r"create or replace function public\.get_table_return_visit_audience.*?"
        r"grant execute on function public\.get_table_return_visit_audience\(jsonb, date\) to service_role;",
        text, re.S)
    if not match:
        raise RuntimeError('could not find the audience function in the return-visit migration')
    return match.group(0)


def main():
    with tempfile.TemporaryDirectory(prefix='ns-pg-') as folder:
        work = Path(folder); socket = work / 's'; socket.mkdir(); cluster = work / 'db'
        subprocess.run([str(PG / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'log'), '-o',
                        f"-k {socket} -c listen_addresses='' -c timezone=UTC", '-w', 'start'], check=True, capture_output=True)
        cmd = [str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']

        def sql(value):
            result = subprocess.run(cmd, input=value, text=True, capture_output=True)
            if result.returncode:
                raise RuntimeError(result.stderr)
            for line in result.stderr.splitlines():
                if 'PASS ' in line:
                    print(line.split('NOTICE:  ', 1)[-1])
            return result.stdout.strip()

        def check(expression, label):
            sql("SELECT fixture_assert(" + expression + ",'" + label.replace("'", "''") + "');")

        def refused(statement, marker, label):
            result = subprocess.run(cmd, input=statement, text=True, capture_output=True)
            check(str(result.returncode != 0 and marker in result.stderr).lower(), label)

        def audience(filter_json):
            return sql("SELECT coalesce(string_agg(right(customer_id::text, 2), ',' ORDER BY customer_id), '') "
                       f"FROM get_table_return_visit_audience('{filter_json}'::jsonb, london_today());")

        def tally():
            return sql(f"SELECT coalesce(no_show_count::text, 'null') FROM customers WHERE id = {cust(5)};")

        def set_status(status):
            sql(f"UPDATE table_bookings SET status = '{status}' WHERE id = {booking(6)};")

        try:
            sql(SCHEMA)
            sql(baseline_audience_sql())
            sql(SEED)

            # Before the change: an undo leaves the tally raised, which is the defect.
            set_status('no_show'); set_status('confirmed')
            check(f"'{tally()}' = '1'", 'before the change, undoing a no-show leaves the tally raised')
            sql(f"UPDATE customers SET no_show_count = 0 WHERE id = {cust(5)};")
            before_live = audience(LIVE_FILTER)
            before_recent = audience(RECENT_FILTER)
            check(f"'{before_live}' = '01,04'", 'before the change, the live filter selects the two 50-day visits')
            check(f"'{before_recent}' = '01,02,03,04'", 'before the change, a one-day filter selects the recent no-shows too')

            # 1. Columns, the link type and the tally.
            sql(SCHEMA_MIGRATION.read_text())
            print('PASS the schema migration applies')
            check("""(SELECT count(*) = 5 FROM information_schema.columns WHERE table_name = 'table_bookings' AND is_nullable = 'YES'
                       AND column_default IS NULL AND column_name IN ('no_show_follow_up_claimed_at', 'no_show_follow_up_sent_at',
                       'no_show_guest_response', 'no_show_guest_reason', 'no_show_guest_responded_at'))""",
                  'five nullable columns with no default')
            check("(SELECT count(*) = 6 FROM table_bookings WHERE no_show_follow_up_claimed_at IS NULL AND no_show_guest_response IS NULL)",
                  'every existing booking reads as never emailed and never answered')
            sql(f"UPDATE table_bookings SET no_show_guest_response = 'attended' WHERE id = {booking(6)};")
            sql(f"UPDATE table_bookings SET no_show_guest_response = 'could_not_make_it', no_show_guest_reason = 'forgot' WHERE id = {booking(6)};")
            refused(f"UPDATE table_bookings SET no_show_guest_response = 'maybe' WHERE id = {booking(6)};",
                    'table_bookings_no_show_guest_response_ck', 'an unknown reply is refused')
            refused(f"UPDATE table_bookings SET no_show_guest_reason = repeat('x', 401) WHERE id = {booking(6)};",
                    'table_bookings_no_show_guest_reason_ck', 'a reason longer than 400 characters is refused')
            sql(f"UPDATE table_bookings SET no_show_guest_response = NULL, no_show_guest_reason = NULL WHERE id = {booking(6)};")

            sql(f"INSERT INTO guest_tokens (hashed_token, customer_id, table_booking_id, action_type) VALUES ('h1', {cust(5)}, {booking(6)}, 'no_show_follow_up');")
            sql(f"INSERT INTO guest_tokens (hashed_token, customer_id, table_booking_id, action_type) VALUES ('h2', {cust(5)}, {booking(6)}, 'booking_confirm');")
            sql(f"INSERT INTO guest_tokens (hashed_token, customer_id, action_type) VALUES ('h3', {cust(5)}, 'card_capture');")
            print('PASS the new link type is accepted and the old ones still are')
            refused(f"INSERT INTO guest_tokens (hashed_token, customer_id, action_type) VALUES ('h4', {cust(5)}, 'no_show_follow_up');",
                    'guest_tokens_no_show_follow_up_scope_check', 'a no-show link with no booking is refused')
            refused(f"INSERT INTO guest_tokens (hashed_token, customer_id, action_type) VALUES ('h5', {cust(5)}, 'something_else');",
                    'guest_tokens_action_type_check', 'an unknown link type is still refused')

            set_status('no_show')
            check(f"'{tally()}' = '1'", 'a no-show raises the tally by one')
            set_status('no_show')
            check(f"'{tally()}' = '1'", 'saving a no-show again does not raise it twice')
            set_status('confirmed')
            check(f"'{tally()}' = '0'", 'putting a no-show back to confirmed lowers the tally')
            set_status('confirmed')
            check(f"'{tally()}' = '0'", 'an ordinary save of a confirmed booking leaves the tally alone')
            set_status('no_show'); set_status('completed')
            check(f"'{tally()}' = '0'", 'any other way out of no-show lowers it too')
            set_status('no_show')
            sql(f"UPDATE customers SET no_show_count = 0 WHERE id = {cust(5)};")
            set_status('confirmed')
            check(f"'{tally()}' = '0'", 'the tally never goes below zero')
            sql(f"UPDATE customers SET no_show_count = NULL WHERE id = {cust(5)};")
            set_status('no_show')
            check(f"'{tally()}' = '1'", 'a missing tally counts as zero when a no-show is added')
            sql(f"UPDATE customers SET no_show_count = NULL WHERE id = {cust(5)};")
            set_status('confirmed')
            check(f"'{tally()}' = '0'", 'a missing tally counts as zero when a no-show is undone')
            check(f"(SELECT no_show_count = 0 FROM customers WHERE id = {cust(1)})", 'nobody else is touched')
            check("""(SELECT NOT p.prosecdef AND p.proconfig = '{"search_path=public, pg_catalog"}'
                       AND has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('service_role', p.oid, 'EXECUTE')
                     FROM pg_proc p WHERE p.proname = 'update_customer_booking_stats')""",
                  'the trigger function keeps its search_path, is still not security definer, and its grants are unchanged')

            # 2. The audience.
            sql(AUDIENCE_MIGRATION.read_text())
            print('PASS the audience migration applies')
            check(f"'{audience(LIVE_FILTER)}' = '{before_live}'", 'with nobody emailed, the live filter selects exactly who it did')
            check(f"'{audience(RECENT_FILTER)}' = '{before_recent}'", 'with nobody emailed, the one-day filter selects exactly who it did')

            sql(f"UPDATE table_bookings SET no_show_follow_up_sent_at = london_noon_days_ago(4) WHERE id = {booking(2)};")
            check(f"'{audience(RECENT_FILTER)}' = '01,03,04'", 'a guest emailed 4 days ago is held')
            sql(f"UPDATE table_bookings SET no_show_follow_up_sent_at = london_noon_days_ago(0) WHERE id = {booking(2)};")
            check(f"'{audience(RECENT_FILTER)}' = '01,03,04'", 'a guest emailed today is held')
            sql(f"UPDATE table_bookings SET no_show_follow_up_sent_at = london_noon_days_ago(13) WHERE id = {booking(3)};")
            check(f"'{audience(RECENT_FILTER)}' = '01,04'", 'a guest emailed 13 days ago is still held')
            sql(f"UPDATE table_bookings SET no_show_follow_up_sent_at = london_noon_days_ago(14) WHERE id = {booking(3)};")
            check(f"'{audience(RECENT_FILTER)}' = '01,03,04'", 'the hold ends on day 14')
            # A booking that never anchors (Christmas, since cancelled) still holds its guest.
            sql(f"UPDATE table_bookings SET no_show_follow_up_sent_at = london_noon_days_ago(2) WHERE id = {booking(5)};")
            check(f"'{audience(LIVE_FILTER)}' = '01'", 'the email holds the guest whichever of their bookings it was about')
            sql(f"UPDATE table_bookings SET no_show_follow_up_sent_at = london_noon_days_ago(20) WHERE id = {booking(5)};")
            check(f"'{audience(LIVE_FILTER)}' = '01,04'", 'and lets them back in afterwards')
            check(f"(SELECT anchor_was_no_show AND last_party_size = 4 AND visit_count = 0 FROM get_table_return_visit_audience('{RECENT_FILTER}'::jsonb, london_today()) WHERE customer_id = {cust(3)})",
                  'the columns returned are unchanged')
            check("""(SELECT p.prosecdef AND p.provolatile = 's' AND p.proconfig = '{search_path=public}'
                       AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                       AND has_function_privilege('service_role', p.oid, 'EXECUTE')
                     FROM pg_proc p WHERE p.proname = 'get_table_return_visit_audience')""",
                  'the audience is still security definer, stable, search_path pinned and service_role only')
            check("(SELECT count(*) = 0 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef AND p.proconfig IS NULL)",
                  'no security definer function is left without a search_path')

            # 3. The flag.
            sql(FLAG_MIGRATION.read_text())
            check("""(SELECT value = '{"bounce_sms_fallback": true, "event_promo_intro_sms_no_email": false, "table_no_show_follow_up": true}'::jsonb
                     FROM system_settings WHERE key = 'messaging_flags')""",
                  'the flag is switched on and no other flag changes')
            sql(FLAG_MIGRATION.read_text())
            check("(SELECT count(*) = 1 AND bool_and(value ->> 'table_no_show_follow_up' = 'true') FROM system_settings WHERE key = 'messaging_flags')",
                  'running the flag migration twice changes nothing')
            sql("DELETE FROM system_settings;")
            sql(FLAG_MIGRATION.read_text())
            check("""(SELECT value = '{"table_no_show_follow_up": true}'::jsonb FROM system_settings WHERE key = 'messaging_flags')""",
                  'with no settings row yet, the flag migration creates it')
            print('ALL PASS')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
