#!/usr/bin/env python3
"""Run the merge customers migration in an isolated socket-only PostgreSQL database.

BK-164 (customer bookings review of 24 October 2026): managers can merge duplicate customers.
The customers table and the tables that point at it are fixtures with production's columns,
foreign keys and unique indexes (read 27 October 2026), and the suppression list migration
(20261027154844) is loaded first because the merge writes to it.

Against that baseline the defect is shown: a guest with a new number has two records, and the
kept one cannot be given the duplicate's email because the unique index refuses it. Then the
migration runs. A preview reports exactly what would move and changes nothing; each blocker
(the same record twice, a missing or anonymised record, both booked on the same event, both
invoice vendors, both in the same loyalty programme) refuses and changes nothing. A real merge
moves every reference (a table added later is found from the catalogue), drops duplicate set
entries, adds up category stats, leaves clashing history with the duplicate, keeps the most
restrictive consent and never adds an opt-in, moves the email with its delivery health, joins
the notes, adds no-show counts, keeps the earlier created date, lists the duplicate's opt-outs
on the suppression list and anonymises it without deleting any customers row. It also checks the
grants, that a rolled-back run changes nothing, and that the rollback removes both functions.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
SUPPRESSIONS = ROOT / 'supabase/migrations/20261027154844_customer_contact_suppressions.sql'
MIGRATION = ROOT / 'supabase/migrations/20261027154845_merge_customers.sql'
ROLLBACK = ROOT / 'tasks/merge-customers/rollback.sql'

KEEP = '00000000-0000-0000-0000-00000000000a'
DUP = '00000000-0000-0000-0000-00000000000b'
OTHER = '00000000-0000-0000-0000-00000000000c'

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL, last_name text NOT NULL,
  mobile_number text CHECK (mobile_number IS NULL OR mobile_number ~ '^\+[1-9]\d{7,14}$' OR mobile_number ~ '^0[1-9]\d{9,10}$'),
  mobile_e164 varchar, mobile_number_raw text, email varchar,
  created_at timestamptz NOT NULL DEFAULT now(),
  internal_notes text, stripe_customer_id text, no_show_count integer DEFAULT 0,
  sms_opt_in boolean DEFAULT true,
  sms_status text NOT NULL DEFAULT 'active' CHECK (sms_status IN ('active', 'opted_out', 'sms_deactivated')),
  messaging_status text DEFAULT 'active' CHECK (messaging_status IN ('active', 'suspended', 'invalid_number', 'opted_out')),
  whatsapp_opt_in boolean NOT NULL DEFAULT false,
  whatsapp_status text NOT NULL DEFAULT 'unknown'
    CHECK (whatsapp_status IN ('unknown', 'active', 'opted_out', 'whatsapp_deactivated', 'invalid')),
  marketing_sms_opt_in boolean NOT NULL DEFAULT false,
  marketing_email_opt_in boolean NOT NULL DEFAULT false,
  marketing_whatsapp_opt_in boolean NOT NULL DEFAULT false,
  sms_opted_out_at timestamptz, whatsapp_opted_out_at timestamptz,
  marketing_sms_opted_out_at timestamptz, marketing_email_opted_out_at timestamptz,
  marketing_whatsapp_opted_out_at timestamptz,
  email_status text NOT NULL DEFAULT 'unknown', email_delivery_failures integer NOT NULL DEFAULT 0,
  last_email_failure_reason text, last_successful_email_at timestamptz, email_deactivated_at timestamptz,
  last_sms_failure_reason text, sms_deactivation_reason text, last_whatsapp_failure_reason text,
  whatsapp_deactivation_reason text, sms_opt_in_source text, whatsapp_opt_in_source text,
  is_placeholder boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX idx_customers_mobile_e164 ON public.customers (mobile_e164);
CREATE UNIQUE INDEX idx_customers_email_unique ON public.customers (lower(email::text));

CREATE TABLE public.events (id uuid PRIMARY KEY);
CREATE TABLE public.bookings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES customers ON DELETE CASCADE,
  event_id uuid, status text);
CREATE UNIQUE INDEX idx_bookings_customer_event_active_unique ON public.bookings (customer_id, event_id)
  WHERE status IN ('pending_payment', 'confirmed');
CREATE TABLE public.table_bookings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid REFERENCES customers ON DELETE RESTRICT);
CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid REFERENCES customers ON DELETE CASCADE);
CREATE TABLE public.customer_consents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES customers ON DELETE CASCADE, status text);
CREATE TABLE public.customer_label_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers ON DELETE CASCADE, label_id uuid, UNIQUE (customer_id, label_id));
CREATE TABLE public.event_interest_manual_recipients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid, customer_id uuid REFERENCES customers ON DELETE CASCADE, UNIQUE (event_id, customer_id));
CREATE TABLE public.customer_scores (customer_id uuid PRIMARY KEY REFERENCES customers ON DELETE CASCADE, total_score integer);
CREATE TABLE public.customer_category_stats (customer_id uuid REFERENCES customers ON DELETE CASCADE, category_id uuid,
  times_attended integer, last_attended_date date, first_attended_date date, updated_at timestamptz,
  PRIMARY KEY (customer_id, category_id));
CREATE TABLE public.event_check_ins (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid,
  customer_id uuid REFERENCES customers ON DELETE CASCADE, UNIQUE (event_id, customer_id));
CREATE TABLE public.marketing_campaign_recipients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid,
  customer_id uuid REFERENCES customers ON DELETE CASCADE);
CREATE UNIQUE INDEX mcr_campaign_customer_key ON public.marketing_campaign_recipients (campaign_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE TABLE public.promo_sequence (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid REFERENCES customers, event_id uuid,
  UNIQUE (customer_id, event_id));
CREATE TABLE public.email_unsubscribe_tokens (token text PRIMARY KEY, customer_id uuid UNIQUE REFERENCES customers ON DELETE CASCADE);
CREATE TABLE public.invoice_vendors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid REFERENCES customers);
CREATE UNIQUE INDEX invoice_vendors_customer_id_key ON public.invoice_vendors (customer_id) WHERE customer_id IS NOT NULL;
CREATE TABLE public.loyalty_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid REFERENCES customers ON DELETE CASCADE,
  program_id uuid, UNIQUE (customer_id, program_id));
CREATE TABLE public.unmatched_communications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  linked_customer_id uuid REFERENCES customers ON DELETE SET NULL, candidate_customer_ids uuid[] DEFAULT '{}');
-- customer_id with no foreign key, as in production.
CREATE TABLE public.signing_parties (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, typed_name text);
CREATE TABLE public.private_booking_complaints (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid);
CREATE TABLE public.webhook_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid);
-- A table added after this migration: the catalogue loop must still move it.
CREATE TABLE public.zz_added_later (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), guest uuid REFERENCES customers);

CREATE FUNCTION fixture_assert(boolean, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %', $2; END IF; RAISE NOTICE 'PASS %', $2; END $$;
GRANT EXECUTE ON FUNCTION fixture_assert(boolean, text) TO PUBLIC;
"""

DATA = f"""
-- Jo Bloggs changed phone. The duplicate (old number) said STOP, unsubscribed from marketing email
-- and holds the email, whose last send bounced. The kept record (new number) opted in to marketing
-- texts and has no email.
INSERT INTO customers (id, first_name, last_name, mobile_number, mobile_e164, email, created_at, internal_notes,
  no_show_count, marketing_sms_opt_in, marketing_sms_opted_out_at)
VALUES ('{KEEP}', 'Jo', 'Bloggs', '+447700900101', '+447700900101', NULL, '2026-06-01', 'Likes the window table', 1, true, NULL);
INSERT INTO customers (id, first_name, last_name, mobile_number, mobile_e164, email, created_at, internal_notes,
  no_show_count, sms_opt_in, sms_status, sms_opted_out_at, marketing_email_opted_out_at, email_status, email_delivery_failures)
VALUES ('{DUP}', 'Joanne', 'Bloggs', '+447700900102', '+447700900102', 'jo@example.com', '2025-03-01', 'Nut allergy', 2,
  false, 'opted_out', '2026-01-05', '2026-01-06', 'bounced', 3);
INSERT INTO customers (id, first_name, last_name, mobile_number, mobile_e164) VALUES ('{OTHER}', 'Sam', 'Other', '+447700900103', '+447700900103');

INSERT INTO events VALUES ('e0000000-0000-0000-0000-000000000001'), ('e0000000-0000-0000-0000-000000000002');
INSERT INTO bookings (customer_id, event_id, status) VALUES
  ('{DUP}', 'e0000000-0000-0000-0000-000000000001', 'confirmed'),
  ('{DUP}', 'e0000000-0000-0000-0000-000000000002', 'cancelled'),
  ('{KEEP}', 'e0000000-0000-0000-0000-000000000002', 'confirmed');
INSERT INTO table_bookings (customer_id) VALUES ('{DUP}'), ('{DUP}'), ('{KEEP}');
INSERT INTO messages (customer_id) VALUES ('{DUP}'), ('{DUP}'), ('{DUP}');
INSERT INTO customer_consents (customer_id, status) VALUES ('{DUP}', 'opted_out'), ('{KEEP}', 'opted_in');
INSERT INTO customer_label_assignments (customer_id, label_id) VALUES
  ('{DUP}', 'a0000000-0000-0000-0000-000000000001'), ('{DUP}', 'a0000000-0000-0000-0000-000000000002'),
  ('{KEEP}', 'a0000000-0000-0000-0000-000000000001');
INSERT INTO event_interest_manual_recipients (event_id, customer_id) VALUES ('e0000000-0000-0000-0000-000000000001', '{DUP}');
INSERT INTO customer_scores VALUES ('{DUP}', 40), ('{KEEP}', 10);
INSERT INTO customer_category_stats VALUES
  ('{DUP}', 'c0000000-0000-0000-0000-000000000001', 3, '2026-02-01', '2025-04-01', now()),
  ('{KEEP}', 'c0000000-0000-0000-0000-000000000001', 1, '2026-07-01', '2026-07-01', now()),
  ('{DUP}', 'c0000000-0000-0000-0000-000000000002', 2, '2025-12-01', '2025-11-01', now());
INSERT INTO event_check_ins (event_id, customer_id) VALUES
  ('e0000000-0000-0000-0000-000000000002', '{DUP}'), ('e0000000-0000-0000-0000-000000000002', '{KEEP}'),
  ('e0000000-0000-0000-0000-000000000001', '{DUP}');
INSERT INTO marketing_campaign_recipients (campaign_id, customer_id) VALUES ('d0000000-0000-0000-0000-000000000001', '{DUP}');
INSERT INTO email_unsubscribe_tokens VALUES ('tok-dup', '{DUP}');
INSERT INTO unmatched_communications (linked_customer_id, candidate_customer_ids) VALUES
  ('{DUP}', ARRAY['{DUP}', '{KEEP}', '{OTHER}']::uuid[]);
INSERT INTO signing_parties (customer_id, typed_name) VALUES ('{DUP}', 'Joanne Bloggs');
INSERT INTO private_booking_complaints (customer_id) VALUES ('{DUP}');
INSERT INTO webhook_logs (customer_id) VALUES ('{DUP}');
INSERT INTO zz_added_later (guest) VALUES ('{DUP}');
"""

# Every row that points at either record, by table, in a fixed text form.
SNAPSHOT = f"""SELECT string_agg(t || '=' || n, ',' ORDER BY t) FROM (
  SELECT 'customers:' || first_name || ' ' || last_name || ':' || coalesce(email, '-') || ':' || sms_status AS t, 1 AS n FROM customers
  UNION ALL SELECT 'bookings:' || customer_id || ':' || status, count(*) FROM bookings GROUP BY customer_id, status
  UNION ALL SELECT 'table_bookings:' || customer_id, count(*) FROM table_bookings GROUP BY customer_id
  UNION ALL SELECT 'messages:' || customer_id, count(*) FROM messages GROUP BY customer_id
  UNION ALL SELECT 'labels:' || customer_id, count(*) FROM customer_label_assignments GROUP BY customer_id
  UNION ALL SELECT 'check_ins:' || customer_id, count(*) FROM event_check_ins GROUP BY customer_id
  UNION ALL SELECT 'later:' || guest, count(*) FROM zz_added_later GROUP BY guest
  UNION ALL SELECT 'suppressions', count(*) FROM customer_contact_suppressions) s;"""

CATALOG = """SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:' || proname || ':' || md5(prosrc) AS x FROM pg_proc WHERE pronamespace = 'public'::regnamespace
  UNION ALL SELECT 'rel:' || relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
  UNION ALL SELECT 'trg:' || tgname FROM pg_trigger WHERE NOT tgisinternal) s;"""


def main():
    with tempfile.TemporaryDirectory(prefix='bk164-pg-') as folder:
        work = Path(folder); socket = work / 'socket'; socket.mkdir(); cluster = work / 'db'
        subprocess.run([str(PG / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'log'), '-o', f"-k {socket} -c listen_addresses=''", '-w', 'start'], check=True, capture_output=True)
        cmd = [str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']

        def sql(value):
            result = subprocess.run(cmd, input=value, text=True, capture_output=True)
            if result.returncode: raise RuntimeError(result.stderr)
            for line in result.stderr.splitlines():
                if 'PASS ' in line: print(line.split('NOTICE:  ', 1)[-1])
            return result.stdout.strip()

        def sql_error(value):
            result = subprocess.run(cmd, input=value, text=True, capture_output=True)
            return result.stderr if result.returncode else ''

        def check(expression, label): sql("SELECT fixture_assert(" + expression + ",'" + label.replace("'", "''") + "');")

        def merge(keep, dup, dry_run):
            return json.loads(sql(f"SELECT merge_customers('{keep}', '{dup}', {str(dry_run).lower()})::text;"))

        def blocked(statement, reason, label):
            before = sql(SNAPSHOT)
            result = json.loads(sql(statement))
            if result.get('state') != 'blocked' or result.get('reason') != reason:
                raise RuntimeError(f'FAIL {label}: {result}')
            if sql(SNAPSHOT) != before:
                raise RuntimeError(f'FAIL {label}: a refused merge changed rows')
            print(f'PASS {label}')

        try:
            sql(SETUP)
            sql(SUPPRESSIONS.read_text())
            sql(DATA)
            baseline = sql(CATALOG)

            error = sql_error(f"UPDATE customers SET email = 'jo@example.com' WHERE id = '{KEEP}';")
            if 'idx_customers_email_unique' not in error:
                raise RuntimeError(f'FAIL baseline: the kept record took the duplicate email: {error!r}')
            print('PASS baseline defect: the kept record cannot be given the duplicate\'s email, and there is no merge')
            check("to_regprocedure('public.merge_customers(uuid, uuid, boolean)') IS NULL", 'baseline: no merge function exists')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if sql(CATALOG) != baseline:
                raise RuntimeError('FAIL a rolled-back run changed the catalog')
            print('PASS a rolled-back run changes nothing')

            sql(MIGRATION.read_text())

            for role in ('anon', 'authenticated'):
                error = sql_error(f"SET ROLE {role}; SELECT merge_customers('{KEEP}', '{DUP}', true);")
                if 'permission denied for function merge_customers' not in error:
                    raise RuntimeError(f'FAIL {role} could call merge_customers: {error!r}')
                error = sql_error(f"SET ROLE {role}; SELECT merge_customers_apply('{KEEP}', '{DUP}');")
                if 'permission denied for function merge_customers_apply' not in error:
                    raise RuntimeError(f'FAIL {role} could call merge_customers_apply: {error!r}')
            print('PASS anon and authenticated cannot merge or call the inner function')
            check("has_function_privilege('service_role', 'merge_customers(uuid, uuid, boolean)', 'EXECUTE')",
                  'service_role can merge')
            check("(SELECT bool_and(prosecdef AND proconfig = ARRAY['search_path=public']) FROM pg_proc"
                  " WHERE proname IN ('merge_customers', 'merge_customers_apply'))",
                  'both functions are SECURITY DEFINER with a fixed search_path')

            before = sql(SNAPSHOT)
            preview = merge(KEEP, DUP, True)
            if sql(SNAPSHOT) != before:
                raise RuntimeError('FAIL the preview changed rows')
            if not (preview['state'] == 'merged' and preview['preview'] is True and preview['moved'].get('messages') == 3
                    and preview['moved'].get('table_bookings') == 2 and preview['left_behind'] == {'event_check_ins': 1}):
                raise RuntimeError(f'FAIL the preview did not report the merge: {preview}')
            print('PASS a preview reports exactly what would move and changes nothing')

            blocked(f"SELECT merge_customers('{KEEP}', '{KEEP}', false)::text;", 'same_customer', 'the same record twice is refused')
            blocked(f"SELECT merge_customers('{KEEP}', gen_random_uuid(), false)::text;", 'merge_not_found', 'a missing record is refused')
            sql(f"INSERT INTO bookings (customer_id, event_id, status) VALUES ('{KEEP}', 'e0000000-0000-0000-0000-000000000001', 'pending_payment');")
            blocked(f"SELECT merge_customers('{KEEP}', '{DUP}', false)::text;", 'both_booked_same_event',
                    'both records holding a live booking for the same event is refused')
            sql(f"DELETE FROM bookings WHERE customer_id = '{KEEP}' AND event_id = 'e0000000-0000-0000-0000-000000000001';")
            sql(f"INSERT INTO invoice_vendors (customer_id) VALUES ('{KEEP}'), ('{DUP}');")
            blocked(f"SELECT merge_customers('{KEEP}', '{DUP}', false)::text;", 'both_invoice_vendors',
                    'both records linked to an invoice vendor is refused')
            sql(f"DELETE FROM invoice_vendors WHERE customer_id = '{KEEP}';")
            sql(f"INSERT INTO loyalty_members (customer_id, program_id) VALUES ('{KEEP}', 'f0000000-0000-0000-0000-000000000001'),"
                f" ('{DUP}', 'f0000000-0000-0000-0000-000000000001');")
            blocked(f"SELECT merge_customers('{KEEP}', '{DUP}', false)::text;", 'both_loyalty_members',
                    'both records in the same loyalty programme is refused')
            sql(f"DELETE FROM loyalty_members WHERE customer_id = '{KEEP}';")

            customers_before = sql('SELECT count(*) FROM customers;')
            result = merge(KEEP, DUP, False)
            if result['state'] != 'merged' or result['preview'] is not False:
                raise RuntimeError(f'FAIL the merge did not run: {result}')
            print('PASS the merge runs')

            for table, column in (('bookings', 'customer_id'), ('table_bookings', 'customer_id'), ('messages', 'customer_id'),
                                  ('customer_consents', 'customer_id'), ('invoice_vendors', 'customer_id'),
                                  ('loyalty_members', 'customer_id'), ('signing_parties', 'customer_id'),
                                  ('private_booking_complaints', 'customer_id'), ('webhook_logs', 'customer_id'),
                                  ('unmatched_communications', 'linked_customer_id'), ('zz_added_later', 'guest'),
                                  ('marketing_campaign_recipients', 'customer_id'), ('event_interest_manual_recipients', 'customer_id'),
                                  ('customer_scores', 'customer_id'), ('customer_category_stats', 'customer_id'),
                                  ('customer_label_assignments', 'customer_id')):
                check(f"NOT EXISTS (SELECT 1 FROM {table} WHERE {column} = '{DUP}')", f'nothing in {table} points at the duplicate')
            check(f"(SELECT count(*) FROM bookings WHERE customer_id = '{KEEP}') = 3 AND (SELECT count(*) FROM messages WHERE customer_id = '{KEEP}') = 3",
                  "the duplicate's bookings and messages are on the kept record")
            check(f"(SELECT count(*) FROM customer_consents WHERE customer_id = '{KEEP}') = 2", 'consent history is kept in full on the kept record')
            check(f"(SELECT count(*) FROM zz_added_later WHERE guest = '{KEEP}') = 1", 'a table added later is moved, found from the catalogue')
            check(f"(SELECT count(*) FROM customer_label_assignments WHERE customer_id = '{KEEP}') = 2", 'labels are combined without a duplicate')
            check(f"(SELECT candidate_customer_ids::text FROM unmatched_communications) IN ('{{{KEEP},{OTHER}}}', '{{{OTHER},{KEEP}}}')",
                  'the holding queue candidates name the kept record once')
            check(f"(SELECT times_attended = 4 AND first_attended_date = '2025-04-01' AND last_attended_date = '2026-07-01' FROM customer_category_stats"
                  f" WHERE customer_id = '{KEEP}' AND category_id = 'c0000000-0000-0000-0000-000000000001')", 'category stats are added together')
            check(f"(SELECT total_score FROM customer_scores WHERE customer_id = '{KEEP}') = 10", "the kept record's own engagement score stays")
            check(f"(SELECT count(*) FROM event_check_ins WHERE customer_id = '{DUP}') = 1 AND (SELECT count(*) FROM event_check_ins WHERE customer_id = '{KEEP}') = 2",
                  'a check-in that would clash stays with the duplicate, the other one moves')
            check(f"(SELECT customer_id FROM email_unsubscribe_tokens WHERE token = 'tok-dup') = '{KEEP}'",
                  "the duplicate's unsubscribe link now unsubscribes the kept record")
            check(f"(SELECT typed_name FROM signing_parties) = 'Joanne Bloggs'", 'a signed party moves without its evidence being edited')

            check(f"(SELECT sms_status = 'opted_out' AND sms_opt_in = false AND sms_opted_out_at = '2026-01-05' FROM customers WHERE id = '{KEEP}')",
                  "the duplicate's STOP applies to the kept record")
            check(f"(SELECT marketing_email_opt_in = false AND marketing_email_opted_out_at = '2026-01-06' FROM customers WHERE id = '{KEEP}')",
                  "the duplicate's marketing email unsubscribe applies to the kept record")
            check(f"(SELECT marketing_sms_opt_in FROM customers WHERE id = '{KEEP}')",
                  "the kept record's own marketing text opt-in stands, since the duplicate never opted out of it")
            check(f"(SELECT email = 'jo@example.com' AND email_status = 'bounced' AND email_delivery_failures = 3 FROM customers WHERE id = '{KEEP}')",
                  'the email moves to the kept record with its delivery health')
            check(f"(SELECT internal_notes = E'Likes the window table\\n\\nFrom merged record: Nut allergy' FROM customers WHERE id = '{KEEP}')",
                  "the duplicate's notes are added to the kept record's")
            check(f"(SELECT no_show_count = 3 AND created_at = '2025-03-01' AND first_name = 'Jo' AND mobile_e164 = '+447700900101'"
                  f" FROM customers WHERE id = '{KEEP}')", 'no-shows add up, the earlier created date is kept, the name and phone stay')
            check(f"(SELECT first_name = 'Merged' AND last_name = 'Customer' AND email IS NULL AND mobile_e164 IS NULL AND mobile_number = '07700900000'"
                  f" AND sms_status = 'opted_out' AND is_placeholder AND internal_notes LIKE 'Merged into customer {KEEP} on %' FROM customers WHERE id = '{DUP}')",
                  'the duplicate is anonymised and says which record it was merged into')
            check(f"(SELECT count(*) FROM customers) = {customers_before}", 'no customers row is deleted')
            check("(SELECT sms_opted_out AND marketing_email_opted_out AND source = 'customer_merged' FROM customer_contact_suppressions"
                  " WHERE contact_kind = 'phone' AND contact_hash = customer_contact_hash('phone', '+447700900102'))",
                  "the duplicate's old number goes on the suppression list with its opt-outs")
            sql("INSERT INTO customers (first_name, last_name, mobile_number, mobile_e164) VALUES ('Jo', 'Again', '+447700900102', '+447700900102');")
            check("(SELECT sms_status = 'opted_out' FROM customers WHERE last_name = 'Again')",
                  'a text from the old number later starts a record that is opted out')

            blocked(f"SELECT merge_customers('{KEEP}', '{DUP}', false)::text;", 'merge_anonymised',
                    'an anonymised record cannot be merged again')

            sql(ROLLBACK.read_text())
            if sql(CATALOG) != baseline:
                raise RuntimeError('FAIL the rollback did not restore the catalog')
            print('PASS the rollback removes both functions')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
