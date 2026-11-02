#!/usr/bin/env python3
"""Test the return-visit lifecycle migration in a disposable local Postgres.

Hand-written tables holding the columns the functions read, with the production constraints
and the index this migration replaces, synthetic people, and a Unix socket with no network
listener. The REAL migration file is applied on top, so every function, constraint and index
under test comes from supabase/migrations. The send window is stubbed open; triggers and RLS
are not reproduced. Dates are built from the London date, so the run is the same in any zone.

Covers spec section 9.3: the audience (visits, no-shows, placeholder, merged, drinks-only,
venue event and Christmas exclusion, the 45-day edge, later and future bookings, unsubscribe,
bounce, do-not-contact and suppression), promotion (once a day, holdout stable and recorded,
no duplicates, one lifecycle email in 30 days, merge fields), the claim (booked since
selection, frequency cap deferral), issuing (one voucher per recipient on retry, expiry,
source, digital batch, 3-day reminder only), touch 2, completion, the discount given at
redemption, grants and the stats.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261102171000_return_visit_lifecycle.sql'

SCHEMA = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE FUNCTION fixture_assert(boolean, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %', $2; END IF; RAISE NOTICE 'PASS %', $2; END $$;
CREATE FUNCTION london_today() RETURNS date LANGUAGE sql AS $$ SELECT (now() AT TIME ZONE 'Europe/London')::date $$;

CREATE TABLE public.events (id uuid PRIMARY KEY);
CREATE TABLE public.employees (employee_id uuid PRIMARY KEY);
CREATE TABLE public.marketing_settings (id boolean PRIMARY KEY, sends_enabled boolean NOT NULL, frequency_cap_days integer NOT NULL);
CREATE TABLE public.customers (
  id uuid PRIMARY KEY, first_name text NOT NULL, email varchar, email_status text NOT NULL DEFAULT 'unknown',
  marketing_email_opt_in boolean NOT NULL DEFAULT false, marketing_email_opted_out_at timestamptz,
  marketing_last_email_at timestamptz, marketing_reserved_until timestamptz,
  is_placeholder boolean NOT NULL DEFAULT false, merged_into_customer_id uuid);
CREATE TABLE public.business_contacts (
  id uuid PRIMARY KEY, email text, eligibility_status text, marketing_status text, tags text[] DEFAULT '{}',
  last_marketing_email_at timestamptz, marketing_reserved_until timestamptz);
CREATE TABLE public.bookings (id serial PRIMARY KEY, customer_id uuid, event_id uuid, status text NOT NULL DEFAULT 'confirmed');
CREATE TABLE public.table_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, booking_date date NOT NULL,
  booking_time time NOT NULL DEFAULT '13:00', party_size integer NOT NULL DEFAULT 4,
  booking_type text NOT NULL DEFAULT 'regular', status text NOT NULL,
  booking_purpose text NOT NULL DEFAULT 'food', is_venue_event boolean NOT NULL DEFAULT false,
  booking_period_code text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.marketing_do_not_contact (email_normalised text, removed_at timestamptz);
CREATE TABLE public.email_suppressions (email text);
CREATE TABLE public.analytics_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type text, metadata jsonb, created_at timestamptz DEFAULT now());

CREATE TABLE public.marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL DEFAULT 'c', status text NOT NULL DEFAULT 'draft',
  audience_type text NOT NULL DEFAULT 'customer', audience jsonb NOT NULL DEFAULT '{"exclude_tags": [], "include_tags": []}'::jsonb,
  ignores_frequency_cap boolean NOT NULL DEFAULT false, event_id uuid, scheduled_for timestamptz,
  locked_at timestamptz, content_hash text, started_at timestamptz, completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT marketing_campaigns_status_check CHECK (status = ANY (ARRAY['draft','scheduled','sending','paused','completed','cancelled'])));
CREATE TABLE public.marketing_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES marketing_campaigns ON DELETE CASCADE,
  contact_id uuid, customer_id uuid, email text NOT NULL, status text NOT NULL DEFAULT 'pending', skip_reason text,
  failure_class text, error text, attempt_count integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 3,
  next_attempt_at timestamptz, last_attempt_at timestamptz, claimed_at timestamptz, lease_expires_at timestamptz,
  sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT marketing_campaign_recipients_skip_reason_check CHECK (skip_reason IS NULL OR skip_reason = ANY (ARRAY[
    'unsubscribed','suppressed','do_not_contact','frequency_cap','not_eligible','campaign_cancelled','already_booked'])),
  CONSTRAINT mcr_skipped_has_reason CHECK (status <> 'skipped' OR skip_reason IS NOT NULL));
CREATE UNIQUE INDEX marketing_campaign_recipients_campaign_id_contact_id_key ON marketing_campaign_recipients (campaign_id, contact_id);
CREATE UNIQUE INDEX mcr_campaign_customer_key ON marketing_campaign_recipients (campaign_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE TABLE public.marketing_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversion_type text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT marketing_conversions_conversion_type_check CHECK (conversion_type = ANY (ARRAY['christmas_enquiry','private_booking_enquiry','contact_form','other'])));

CREATE TABLE public.terms_versions (version text PRIMARY KEY, effective_from date NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.voucher_types (
  id text PRIMARY KEY, display_title text NOT NULL, cover_title text NOT NULL, value_pence integer,
  requires_booking boolean NOT NULL, alcohol boolean NOT NULL, entitlement_html text NOT NULL, hero jsonb NOT NULL,
  copy jsonb NOT NULL, sort_order integer NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.voucher_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  created_by_name text NOT NULL, note text, terms_version text NOT NULL REFERENCES terms_versions(version),
  type_definitions jsonb NOT NULL, total_count integer NOT NULL, pdf_status text NOT NULL DEFAULT 'pending'
  CHECK (pdf_status = ANY (ARRAY['pending','rendering','ready','failed'])));
CREATE TABLE public.voucher_number_counters (month_key text PRIMARY KEY, last_seq integer NOT NULL DEFAULT 0);
CREATE TABLE public.vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), voucher_number text NOT NULL UNIQUE, type_id text NOT NULL REFERENCES voucher_types,
  batch_id uuid NOT NULL REFERENCES voucher_batches, status text NOT NULL, value_pence integer, terms_version text NOT NULL,
  issued_at timestamptz, issued_by uuid REFERENCES employees(employee_id), issued_by_name text, issued_by_user_id uuid,
  event_id uuid, won_at_label text, expiry_date date, customer_id uuid REFERENCES customers, redeemed_at timestamptz,
  redeemed_by uuid, redeemed_by_name text, redeemed_by_user_id uuid, transaction_ref text, booking_ref text,
  cancelled_at timestamptz, cancelled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vouchers_issued_fields CHECK (status <> ALL (ARRAY['issued','redeemed','expired']) OR
    (issued_at IS NOT NULL AND issued_by_name IS NOT NULL AND won_at_label IS NOT NULL AND expiry_date IS NOT NULL)));
CREATE TABLE public.voucher_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), voucher_id uuid NOT NULL REFERENCES vouchers, action text NOT NULL,
  actor_user_id uuid, actor_employee_id uuid, actor_name text NOT NULL,
  source text NOT NULL CHECK (source = ANY (ARRAY['management','foh','cron','system'])), at timestamptz NOT NULL DEFAULT now(), detail jsonb);
CREATE TABLE public.voucher_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), voucher_id uuid NOT NULL REFERENCES vouchers, customer_id uuid,
  reminder_kind text NOT NULL, status text NOT NULL DEFAULT 'pending', scheduled_for date NOT NULL, attempts integer NOT NULL DEFAULT 0,
  last_error text, channel text, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (voucher_id, reminder_kind));

CREATE FUNCTION public.voucher_redeem(text, uuid, text, uuid, text, text, uuid, date, text, text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.marketing_send_window_open(p_audience_type text) RETURNS boolean LANGUAGE sql AS 'SELECT true';
"""

T1 = "'c1000000-0000-0000-0000-000000000001'"
T2 = "'c1000000-0000-0000-0000-000000000002'"
OTHER = "'c1000000-0000-0000-0000-000000000003'"
ONE_OFF = "'c1000000-0000-0000-0000-000000000004'"


def cust(n):
    return f"'a0000000-0000-0000-0000-{n:012d}'"


# Customer number, first name, email, extra columns.
PEOPLE = [
    (1, 'Sam', 'sam@example.test', ''),            # visit 50 days ago: selected
    (2, 'Pat', 'pat@example.test', ''),            # no-show 60 days ago: selected, flagged
    (3, 'Lou', 'lou@example.test', ''),            # visit 44 days ago: too recent
    (4, 'Kim', 'kim@example.test', ''),            # visit 45 days ago: the edge, selected
    (5, 'Ali', 'ali@example.test', ''),            # visit 181 days ago: too old
    (6, 'Bo', 'bo@example.test', ''),              # visit 50 days ago then a future booking: out
    (7, 'Cy', 'cy@example.test', ''),              # drinks-only: never anchors
    (8, 'Di', 'di@example.test', ''),              # venue event: never anchors
    (9, 'Ed', 'ed@example.test', ''),              # Christmas period booking: never anchors
    (10, 'Flo', 'flo@example.test', ''),           # placeholder
    (11, 'Gus', 'gus@example.test', ''),           # merged
    (12, 'Hal', 'hal@example.test', ''),           # unsubscribed
    (13, 'Ida', 'ida@example.test', ''),           # bounced
    (14, 'Jo', 'jo@example.test', ''),             # do not contact
    (15, 'Kit', 'kit@example.test', ''),           # suppressed
    (16, 'Len', None, ''),                         # no email
    (17, 'Max', 'max@example.test', ''),           # only a cancelled booking
    (18, 'Ned', 'ned@example.test', ''),           # Sunday visit, 63 days ago
    (19, 'Oli', 'oli@example.test', ''),           # Christmas booking_type: never anchors
    (20, 'Pia', 'pia@example.test', ''),           # visit 70 days, then a visit 50 days: anchor is the later
]


def seed_sql():
    rows = []
    for n, name, email, _ in PEOPLE:
        e = 'NULL' if email is None else f"'{email}'"
        rows.append(f"({cust(n)}, '{name}', {e})")
    people = 'INSERT INTO customers (id, first_name, email) VALUES ' + ', '.join(rows) + ';'
    t = 'london_today()'
    # Customer 18's visit is pinned to a Sunday between 63 and 69 days ago.
    sunday = f"({t} - 63 - ((extract(isodow from {t} - 63)::int) % 7))"
    bookings = f"""
INSERT INTO table_bookings (customer_id, booking_date, status, booking_purpose, is_venue_event, booking_period_code, booking_type, party_size) VALUES
 ({cust(1)}, {t} - 50, 'completed', 'food', false, NULL, 'regular', 3),
 ({cust(1)}, {t} - 120, 'confirmed', 'food', false, NULL, 'regular', 6),
 ({cust(2)}, {t} - 60, 'no_show', 'food', false, NULL, 'regular', 2),
 ({cust(3)}, {t} - 44, 'confirmed', 'food', false, NULL, 'regular', 2),
 ({cust(4)}, {t} - 45, 'review_clicked', 'food', false, NULL, 'regular', 25),
 ({cust(5)}, {t} - 181, 'completed', 'food', false, NULL, 'regular', 2),
 ({cust(6)}, {t} - 50, 'completed', 'food', false, NULL, 'regular', 2),
 ({cust(6)}, {t} + 10, 'pending_payment', 'food', false, NULL, 'regular', 2),
 ({cust(7)}, {t} - 50, 'completed', 'drinks', false, NULL, 'regular', 2),
 ({cust(8)}, {t} - 50, 'completed', 'food', true, NULL, 'regular', 2),
 ({cust(9)}, {t} - 50, 'completed', 'food', false, 'christmas-2026', 'regular', 2),
 ({cust(10)}, {t} - 50, 'completed', 'food', false, NULL, 'regular', 2),
 ({cust(11)}, {t} - 50, 'completed', 'food', false, NULL, 'regular', 2),
 ({cust(12)}, {t} - 50, 'completed', 'food', false, NULL, 'regular', 2),
 ({cust(13)}, {t} - 50, 'completed', 'food', false, NULL, 'regular', 2),
 ({cust(14)}, {t} - 50, 'completed', 'food', false, NULL, 'regular', 2),
 ({cust(15)}, {t} - 50, 'completed', 'food', false, NULL, 'regular', 2),
 ({cust(16)}, {t} - 50, 'completed', 'food', false, NULL, 'regular', 2),
 ({cust(17)}, {t} - 50, 'cancelled', 'food', false, NULL, 'regular', 2),
 ({cust(18)}, {sunday}, 'visited_waiting_for_review', 'food', false, NULL, 'regular', 4),
 ({cust(19)}, {t} - 50, 'completed', 'food', false, NULL, 'christmas', 2),
 ({cust(20)}, {t} - 70, 'completed', 'food', false, NULL, 'regular', 2),
 ({cust(20)}, {t} - 50, 'completed', 'food', false, NULL, 'regular', 5);
UPDATE customers SET is_placeholder = true WHERE id = {cust(10)};
UPDATE customers SET merged_into_customer_id = {cust(1)} WHERE id = {cust(11)};
UPDATE customers SET marketing_email_opted_out_at = now() WHERE id = {cust(12)};
UPDATE customers SET email_status = 'bounced' WHERE id = {cust(13)};
INSERT INTO marketing_do_not_contact VALUES ('jo@example.test', NULL);
INSERT INTO email_suppressions VALUES ('KIT@example.test');
"""
    rest = """
INSERT INTO marketing_settings VALUES (true, true, 4);
INSERT INTO terms_versions VALUES ('v2.0', '2026-07-30');
"""
    return people + bookings + rest


TOUCH1_FILTER = ('{"rule": "table_return_visit", "touch": 1, "days_since_anchor_min": 45, "days_since_anchor_max": 180, '
                 '"include_no_shows": true, "voucher_type_id": "return-10", "voucher_valid_days": 30}')


def main():
    with tempfile.TemporaryDirectory(prefix='rv-pg-') as folder:
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

        def audience(filter_json):
            return sql(f"SELECT string_agg(right(customer_id::text, 2), ',' ORDER BY customer_id) FROM get_table_return_visit_audience('{filter_json}'::jsonb);")

        try:
            sql(SCHEMA)
            sql(seed_sql())
            sql(MIGRATION.read_text())
            print('PASS the migration applies')

            # Audience, touch 1.
            got = audience(TOUCH1_FILTER)
            check(f"'{got}' = '01,02,04,18,20'", 'touch 1 selects visits 45 to 180 days old and the no-show, nobody else')
            check(f"(SELECT anchor_was_no_show FROM get_table_return_visit_audience('{TOUCH1_FILTER}') WHERE customer_id = {cust(2)})",
                  'a no-show anchors and is flagged')
            check(f"(SELECT anchor_was_sunday FROM get_table_return_visit_audience('{TOUCH1_FILTER}') WHERE customer_id = {cust(18)})",
                  'a Sunday visit is flagged as Sunday')
            check(f"(SELECT anchor_date = london_today() - 50 AND last_party_size = 3 AND visit_count = 2 FROM get_table_return_visit_audience('{TOUCH1_FILTER}') WHERE customer_id = {cust(1)})",
                  'the anchor is the latest visit, with its party size and the visit count')
            check(f"(SELECT anchor_date = london_today() - 50 AND last_party_size = 5 FROM get_table_return_visit_audience('{TOUCH1_FILTER}') WHERE customer_id = {cust(20)})",
                  'two visits anchor on the later one')
            check(f"(SELECT last_party_size = 20 FROM get_table_return_visit_audience('{TOUCH1_FILTER}') WHERE customer_id = {cust(4)})",
                  'party size is clamped to the website range of 1 to 20')
            no_shows_out = TOUCH1_FILTER.replace('"include_no_shows": true', '"include_no_shows": false')
            check(f"'{audience(no_shows_out)}' = '01,04,18,20'", 'no-shows can be left out by the filter')
            err = subprocess.run(cmd, input="SELECT * FROM get_table_return_visit_audience('{\"rule\": \"other\", \"touch\": 1}');",
                                 text=True, capture_output=True)
            check(f"{str('unknown rule' in err.stderr).lower()}", 'an unknown rule fails rather than selecting everyone')

            # Campaigns. Every day is a send day and the promote time has passed, so the run is
            # deterministic whatever the clock says.
            sql(f"""
INSERT INTO marketing_campaigns (id, name, status, kind, audience, cooldown_days, send_days, promote_at_local, holdout_percent,
  scheduled_for, locked_at, content_hash) VALUES
 ({T1}, 'touch 1', 'sending', 'lifecycle', '{{"customer_filter": {TOUCH1_FILTER}}}', 365, '{{1,2,3,4,5,6,7}}', '00:00', 20, now(), now(), 'h'),
 ({OTHER}, 'another lifecycle', 'sending', 'lifecycle', '{{"customer_filter": {TOUCH1_FILTER}}}', 365, '{{1,2,3,4,5,6,7}}', '00:00', 0, now(), now(), 'h'),
 ({ONE_OFF}, 'round-up', 'scheduled', 'one_off', '{{"exclude_tags": [], "include_tags": []}}', NULL, NULL, NULL, 0, now() - interval '1 minute', now(), 'h');
""")
            err = subprocess.run(cmd, input=f"INSERT INTO marketing_campaigns (name, status, kind, audience) VALUES ('bad', 'draft', 'lifecycle', '{{}}');",
                                 text=True, capture_output=True)
            check(f"{str('marketing_campaigns_lifecycle_fields' in err.stderr).lower()}", 'a lifecycle campaign without its rules is refused')

            # Only T1 should take this audience; OTHER must lose every guest to the 30-day rule.
            sql(f"UPDATE marketing_campaigns SET last_promoted_on = london_today() WHERE id = {OTHER};")
            sql("SELECT * FROM promote_due_marketing_campaigns();")
            check(f"(SELECT status = 'sending' FROM marketing_campaigns WHERE id = {ONE_OFF})", 'a one-off campaign still promotes as before')
            check(f"(SELECT count(*) = 5 FROM marketing_campaign_recipients WHERE campaign_id = {T1})", 'touch 1 adds the day''s five guests')
            check(f"(SELECT last_promoted_on = london_today() FROM marketing_campaigns WHERE id = {T1})", 'touch 1 records the day it promoted')
            check(f"""(SELECT bool_and((status = 'skipped' AND skip_reason = 'holdout') =
                       (((hashtext(customer_id::text)::bigint % 100 + 100) % 100) < 20))
                     FROM marketing_campaign_recipients WHERE campaign_id = {T1})""",
                  'the holdout is the stable hash of the customer, recorded as skipped with reason holdout')
            check(f"(SELECT bool_and(merge_fields ->> 'first_name' IS NOT NULL AND (merge_fields ->> 'party_size')::int BETWEEN 1 AND 20 AND lifecycle_anchor_date IS NOT NULL) FROM marketing_campaign_recipients WHERE campaign_id = {T1})",
                  'every recipient carries a first name, a party size and its anchor visit')

            sql("SELECT * FROM promote_due_marketing_campaigns();")
            check(f"(SELECT count(*) = 5 FROM marketing_campaign_recipients WHERE campaign_id = {T1})", 'a second run on the same day adds nobody')
            sql(f"UPDATE marketing_campaigns SET last_promoted_on = NULL WHERE id IN ({T1}, {OTHER});")
            sql("SELECT * FROM promote_due_marketing_campaigns();")
            check(f"(SELECT count(*) = 5 FROM marketing_campaign_recipients WHERE campaign_id = {T1})", 'a later day adds nobody already in the cooldown')
            check(f"(SELECT count(*) = 0 FROM marketing_campaign_recipients WHERE campaign_id = {OTHER} AND status <> 'skipped')",
                  'nobody gets a second lifecycle email inside 30 days')

            # complete_finished must leave a lifecycle campaign running even with nothing pending.
            sql(f"UPDATE marketing_campaign_recipients SET status = 'skipped', skip_reason = 'not_eligible' WHERE campaign_id = {OTHER};")
            sql("SELECT complete_finished_marketing_campaigns();")
            check(f"(SELECT status = 'sending' FROM marketing_campaigns WHERE id = {OTHER})", 'a lifecycle campaign never completes on its own')

            # Claim. Customer 20 books after selection; customer 1 had an email two days ago.
            sql(f"UPDATE marketing_campaign_recipients SET status = 'pending', skip_reason = NULL WHERE campaign_id = {T1};")
            sql(f"INSERT INTO table_bookings (customer_id, booking_date, status) VALUES ({cust(20)}, london_today() + 3, 'confirmed');")
            sql(f"UPDATE customers SET marketing_last_email_at = now() - interval '2 days' WHERE id = {cust(1)};")
            sql(f"UPDATE marketing_campaigns SET status = 'paused' WHERE id = {ONE_OFF};")
            sql("SELECT count(*) FROM claim_marketing_recipients(10);")
            check(f"(SELECT status = 'skipped' AND skip_reason = 'booked_since_selection' FROM marketing_campaign_recipients WHERE campaign_id = {T1} AND customer_id = {cust(20)})",
                  'a guest who booked after selection is skipped before any voucher')
            check(f"(SELECT status = 'pending' AND next_attempt_at > now() + interval '1 day' FROM marketing_campaign_recipients WHERE campaign_id = {T1} AND customer_id = {cust(1)})",
                  'the frequency cap defers a lifecycle guest instead of skipping them')
            check(f"(SELECT count(*) = 3 FROM marketing_campaign_recipients WHERE campaign_id = {T1} AND status = 'sending')",
                  'the other three guests are claimed')

            # Issue.
            first = sql(f"SELECT id FROM marketing_campaign_recipients WHERE campaign_id = {T1} AND status = 'sending' ORDER BY customer_id LIMIT 1;")
            result = sql(f"SELECT issue_lifecycle_voucher('{first}')::text;")
            check(f"(SELECT (r ->> 'success')::boolean AND r ->> 'voucher_number' ~ '^AN-[0-9]{{4}}-0001$' FROM (SELECT '{result}'::jsonb r) x)",
                  'issuing returns a ledger number from the monthly counter')
            again = sql(f"SELECT issue_lifecycle_voucher('{first}')::text;")
            check(f"(SELECT '{again}'::jsonb ->> 'voucher_number' = '{result}'::jsonb ->> 'voucher_number' AND ('{again}'::jsonb ->> 'idempotent_replay')::boolean)",
                  'a retry for the same recipient returns the same voucher')
            check(f"(SELECT count(*) = 1 FROM vouchers)", 'a retry never issues a second voucher')
            check(f"""(SELECT v.status = 'issued' AND v.expiry_date = london_today() + 30 AND v.issued_by IS NULL
                     AND v.issued_by_name = 'Return visit email' AND v.won_at_label = 'Come back offer, touch 1' AND v.value_pence = 600
                     AND v.marketing_recipient_id = '{first}' FROM vouchers v)""",
                  'the voucher is issued by the system, valid 30 London days, linked to the recipient')
            check("(SELECT bool_and(source = 'system') AND count(*) = 2 FROM voucher_events)", 'its generated and issued events say source system')
            check("(SELECT digital AND pdf_status = 'ready' AND total_count = 1 AND marketing_campaign_id IS NOT NULL FROM voucher_batches)",
                  'the batch is digital, ready with no PDF, and tied to the campaign')
            check("(SELECT string_agg(reminder_kind || ':' || status, ',') = 'pre_expiry_3:pending' FROM voucher_reminders)",
                  'only the 3-day reminder is scheduled')
            check(f"(SELECT merge_fields ->> 'voucher_number' = '{result}'::jsonb ->> 'voucher_number' AND merge_fields ->> 'voucher_percent' = '10' AND merge_fields ->> 'voucher_expires_on' = (london_today() + 30)::text AND voucher_id IS NOT NULL FROM marketing_campaign_recipients WHERE id = '{first}')",
                  'the recipient carries the voucher number, percentage and expiry for the email')
            second = sql(f"SELECT id FROM marketing_campaign_recipients WHERE campaign_id = {T1} AND status = 'sending' ORDER BY customer_id OFFSET 1 LIMIT 1;")
            sql(f"SELECT issue_lifecycle_voucher('{second}');")
            check("(SELECT count(*) = 1 AND max(total_count) = 2 FROM voucher_batches)", 'a second voucher the same day joins the same batch')
            pending = sql(f"SELECT id FROM marketing_campaign_recipients WHERE campaign_id = {T1} AND status = 'pending' LIMIT 1;")
            check(f"(SELECT issue_lifecycle_voucher('{pending}') ->> 'error_code' = 'NOT_CLAIMED')", 'an unclaimed recipient gets no voucher')
            check("(SELECT count(*) = 2 FROM vouchers)", 'no voucher was issued for it')

            # Touch 2: the first guest's touch 1 went 50 days ago and the voucher expired unused.
            sql(f"""
UPDATE marketing_campaign_recipients SET status = 'sent', sent_at = now() - interval '50 days' WHERE id IN ('{first}', '{second}');
UPDATE vouchers SET status = 'expired' WHERE marketing_recipient_id = '{first}';
INSERT INTO marketing_campaigns (id, name, status, kind, audience, cooldown_days, send_days, promote_at_local, scheduled_for, locked_at, content_hash)
VALUES ({T2}, 'touch 2', 'draft', 'lifecycle',
  '{{"customer_filter": {{"rule": "table_return_visit", "touch": 2, "days_since_previous_touch_min": 45, "previous_campaign_id": {T1.replace("'", '"')}, "include_no_shows": true, "voucher_type_id": "return-25", "voucher_valid_days": 30}}}}',
  365, '{{1,2,3,4,5,6,7}}', '00:00', now(), now(), 'h');
""")
            touch2 = sql(f"SELECT string_agg(customer_id::text, ',') FROM get_table_return_visit_audience((SELECT audience -> 'customer_filter' FROM marketing_campaigns WHERE id = {T2}));")
            first_customer = sql(f"SELECT customer_id FROM marketing_campaign_recipients WHERE id = '{first}';")
            check(f"'{touch2}' = '{first_customer}'", 'touch 2 selects only the guest whose touch 1 voucher expired unused')
            sql(f"UPDATE vouchers SET status = 'redeemed', redeemed_at = now(), redeemed_by_name = 'x' WHERE marketing_recipient_id = '{first}';")
            touch2 = sql(f"SELECT count(*) FROM get_table_return_visit_audience((SELECT audience -> 'customer_filter' FROM marketing_campaigns WHERE id = {T2}));")
            check(f"{touch2} = 0", 'a redeemed touch 1 voucher means no touch 2')

            # Constraints and grants.
            check("(SELECT count(*) = 2 FROM voucher_types WHERE id IN ('return-10', 'return-25') AND discount_kind = 'percent' AND digital_only)",
                  'the two percentage voucher types exist as data')
            sql("INSERT INTO marketing_conversions (conversion_type, metadata) VALUES ('table_booking', '{\"table_booking_id\": \"b1\"}');")
            err = subprocess.run(cmd, input="INSERT INTO marketing_conversions (conversion_type, metadata) VALUES ('table_booking', '{\"table_booking_id\": \"b1\"}');",
                                 text=True, capture_output=True)
            check(f"{str('marketing_conversions_table_booking_key' in err.stderr).lower()}", 'a table booking converts once')
            check("""(SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                       AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND p.prosecdef AND p.proconfig = '{search_path=public}')
                     FROM pg_proc p WHERE p.proname IN ('get_table_return_visit_audience', 'promote_due_marketing_campaigns', 'complete_finished_marketing_campaigns',
                       'claim_marketing_recipients', 'voucher_reminders_recompute', 'issue_lifecycle_voucher', 'get_lifecycle_campaign_stats',
                       'voucher_redeem', 'voucher_undo_redeem'))""",
                  'every new or replaced function is service_role only, security definer, search_path pinned')
            check(f"(SELECT (get_lifecycle_campaign_stats({T1}) ->> 'vouchers_issued')::int = 2 AND (get_lifecycle_campaign_stats({T1}) ->> 'vouchers_redeemed')::int = 1)",
                  'the stats count vouchers issued and redeemed')
            check(f"(SELECT (get_lifecycle_campaign_stats({T1}) ->> 'booked_since_selection')::int = 1)", 'the stats count guests who booked since selection')
            check("(SELECT count(*) = 0 FROM pg_indexes WHERE indexname = 'mcr_campaign_customer_key')", 'the old per-campaign index is gone')
            err = subprocess.run(cmd, input=f"INSERT INTO marketing_campaign_recipients (campaign_id, customer_id, email) VALUES ({ONE_OFF}, {cust(1)}, 'a'), ({ONE_OFF}, {cust(1)}, 'a');",
                                 text=True, capture_output=True)
            check(f"{str('mcr_campaign_customer_anchor_key' in err.stderr).lower()}", 'a one-off campaign still holds one row per customer')
            # Redemption records the discount given, and undo clears it.
            number = sql(f"SELECT voucher_number FROM vouchers WHERE marketing_recipient_id = '{second}';")
            staff = "'e0000000-0000-0000-0000-000000000001'"
            redeem = (f"SELECT voucher_redeem(p_voucher_number => '{number}', p_employee_id => {staff}, p_employee_name => 'Bar', "
                      f"p_user_id => NULL, p_transaction_ref => NULL, p_booking_ref => NULL, p_customer_id => NULL, "
                      f"p_london_today => london_today(), p_source => 'foh', p_idempotency_key => 'key-1'{{extra}})")
            check(f"({redeem.format(extra=', p_redeemed_value_pence => -1')} ->> 'error_code' = 'VALIDATION_ERROR')", 'a negative discount is refused')
            check(f"(({redeem.format(extra=', p_redeemed_value_pence => 450')} ->> 'success')::boolean)", 'a voucher redeems with the discount given')
            check(f"(SELECT status = 'redeemed' AND redeemed_value_pence = 450 FROM vouchers WHERE voucher_number = '{number}')", 'the discount given is stored on the voucher')
            check(f"(SELECT (detail ->> 'redeemed_value_pence')::int = 450 FROM voucher_events WHERE action = 'redeemed')", 'the redeemed event records the amount')
            check(f"(({redeem.format(extra='')} ->> 'idempotent_replay')::boolean)", 'a caller that sends no amount still works, here as a replay')
            sql(f"SELECT voucher_undo_redeem('{number}', NULL, {staff}, 'Bar', true, NULL, 'foh', 'undo-1');")
            check(f"(SELECT status = 'issued' AND redeemed_value_pence IS NULL FROM vouchers WHERE voucher_number = '{number}')", 'undo clears the amount')
            check("""(SELECT count(*) = 1 AND bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('service_role', p.oid, 'EXECUTE'))
                     FROM pg_proc p WHERE p.proname = 'voucher_redeem')""", 'one voucher_redeem remains, service_role only')
            print('ALL PASS')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
