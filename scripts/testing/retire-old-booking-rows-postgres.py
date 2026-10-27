#!/usr/bin/env python3
"""Run the release 28 data tidy (20261027010145_retire_old_booking_rows) in an isolated socket-only
PostgreSQL database.

Owner decision D36 (customer bookings review of 24 October 2026): BK-223, BK-224, BK-166 and
BK-176. The tables are fixtures with production's columns, constraints and update triggers (read
27 October 2026), filled with rows carrying exactly the ids the migration names, in the states
measured that day, plus look-alike rows that must not be touched: a live booking's active hold
and pending deposit row, a failed deposit row, a confirmed booking still owed a deposit, a TB-W
walk-in, a 27th confirmed booking that reads pending with no deposit but was not measured, and a
short link to another page.

The defect is shown first (the stale states as measured). Each guard is then proven: when any one
measured row has moved on, or an extra row has appeared, the migration refuses and changes nothing.
A rolled-back run changes nothing. The real run makes exactly the approved changes, leaves every
look-alike alone, audits the hold changes, keeps full backups that only the service role can read,
and accepts 'void' as a payment status. The rollback then puts every value back exactly, updated_at
included, restores the payment status check and drops the backups.
"""
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261027010145_retire_old_booking_rows.sql'
ROLLBACK = ROOT / 'tasks/retire-old-booking-rows/rollback.sql'

UUID = r"'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'"


def ids_of(text, name):
    """The uuids in the migration's `name uuid[] := ARRAY[...]` declaration."""
    start = text.index(f'{name} uuid[] := ARRAY[')
    end = text.index(']::uuid[];', start)
    return re.findall(UUID, text[start:end])


SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TYPE public.payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded', 'partial_refund');
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TABLE public.table_bookings (id uuid PRIMARY KEY, booking_reference text, status text NOT NULL,
  payment_status public.payment_status DEFAULT 'pending', paypal_deposit_capture_id text, deposit_amount_locked numeric,
  deposit_amount numeric, deposit_waived boolean DEFAULT false, deposit_refund_status text, confirmed_at timestamptz,
  updated_at timestamptz DEFAULT now());
CREATE TRIGGER table_bookings_updated_at BEFORE UPDATE ON public.table_bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE public.audit_logs (id bigserial PRIMARY KEY, user_id uuid, operation_type text, operation_status text,
  resource_type text, resource_id text, old_values jsonb, new_values jsonb, additional_info jsonb, created_at timestamptz);
CREATE TABLE public.booking_holds (id uuid PRIMARY KEY, hold_type text NOT NULL, table_booking_id uuid, status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'consumed', 'released', 'expired')),
  consumed_at timestamptz, released_at timestamptz, updated_at timestamptz DEFAULT now());
CREATE TRIGGER set_booking_holds_updated_at BEFORE UPDATE ON public.booking_holds FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- Production's audit trigger, reduced to the columns this fixture has.
CREATE FUNCTION public.audit_booking_hold_status_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.audit_logs (user_id, operation_type, operation_status, resource_type, resource_id, old_values, new_values, created_at)
    VALUES (NULL, 'hold_status_change', 'success', 'booking_hold', NEW.id::text, jsonb_build_object('status', OLD.status),
            jsonb_build_object('status', NEW.status), now());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_audit_booking_hold_status AFTER UPDATE ON public.booking_holds FOR EACH ROW EXECUTE FUNCTION audit_booking_hold_status_change();

CREATE TABLE public.payments (id uuid PRIMARY KEY, table_booking_id uuid, charge_type text, amount numeric,
  status text NOT NULL DEFAULT 'pending', metadata jsonb DEFAULT '{}'::jsonb, updated_at timestamptz DEFAULT now(),
  CONSTRAINT payments_status_check CHECK (status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text,
    'refunded'::text, 'partially_refunded'::text])));

-- Production's columns (27 October 2026).
CREATE TABLE public.pending_bookings (id uuid PRIMARY KEY, token uuid UNIQUE DEFAULT gen_random_uuid(), event_id uuid,
  mobile_number varchar NOT NULL, customer_id uuid, seats integer, expires_at timestamptz, confirmed_at timestamptz,
  booking_id uuid, initiated_by_api_key uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  metadata jsonb);
CREATE TABLE public.short_links (id uuid PRIMARY KEY, short_code varchar UNIQUE, destination_url text, expires_at timestamptz,
  updated_at timestamptz DEFAULT now());

CREATE FUNCTION fixture_assert(boolean, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %', $2; END IF; RAISE NOTICE 'PASS %', $2; END $$;
"""

SNAPSHOT = """SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT 'tb:' || t::text AS x FROM table_bookings t
  UNION ALL SELECT 'hold:' || h::text FROM booking_holds h
  UNION ALL SELECT 'pay:' || p::text FROM payments p
  UNION ALL SELECT 'pb:' || b::text FROM pending_bookings b
  UNION ALL SELECT 'link:' || s::text FROM short_links s
  UNION ALL SELECT 'rel:' || relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
  UNION ALL SELECT 'con:' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'payments_status_check') s;"""


def fixture_rows(text):
    consumed = ids_of(text, 'v_holds_consumed')
    released = ids_of(text, 'v_holds_released')
    payments = ids_of(text, 'v_payments')
    no_deposit = ids_of(text, 'v_no_deposit')
    pending = ids_of(text, 'v_pending_bookings')
    links = ids_of(text, 'v_short_links')
    paypal = re.findall(UUID, text[text.index('-- 3. Confirmed times'):text.index('-- 4 needs')])
    partial = re.search(r"v_partial_refund uuid := " + UUID, text).group(1)
    assert (len(consumed), len(released), len(payments), len(no_deposit), len(pending), len(links), len(paypal)) == (5, 1, 9, 26, 48, 2, 4)
    assert partial in paypal

    rows = []
    old = "'2026-05-01 10:00:00+00'"
    for i, hold in enumerate(consumed):
        rows.append(f"INSERT INTO table_bookings (id, booking_reference, status, payment_status, updated_at) VALUES "
                    f"('{f'c{i}000000-0000-0000-0000-000000000000'}', 'TB-HOLD{i}', 'completed', 'completed', {old});")
        rows.append(f"INSERT INTO booking_holds (id, hold_type, table_booking_id, updated_at) VALUES "
                    f"('{hold}', 'payment_hold', 'c{i}000000-0000-0000-0000-000000000000', {old});")
    rows.append(f"INSERT INTO table_bookings (id, booking_reference, status, updated_at) VALUES "
                f"('d0000000-0000-0000-0000-000000000000', 'TB-1E02507C', 'cancelled', {old});")
    rows.append(f"INSERT INTO booking_holds (id, hold_type, table_booking_id, updated_at) VALUES "
                f"('{released[0]}', 'payment_hold', 'd0000000-0000-0000-0000-000000000000', {old});")
    for payment in payments:
        rows.append(f"INSERT INTO payments (id, table_booking_id, charge_type, amount, metadata, updated_at) VALUES "
                    f"('{payment}', 'd0000000-0000-0000-0000-000000000000', 'table_deposit', 70, '{{\"source\": \"foh_booking_create\"}}', {old});")
    for booking in paypal:
        refund = "'partially_refunded'" if booking == partial else 'NULL'
        rows.append(f"INSERT INTO table_bookings (id, booking_reference, status, payment_status, paypal_deposit_capture_id, "
                    f"deposit_amount_locked, deposit_refund_status, updated_at) VALUES "
                    f"('{booking}', 'TB-PAYPAL', 'completed', 'completed', 'CAP-{booking[:4]}', 80, {refund}, {old});")
    for booking in no_deposit:
        rows.append(f"INSERT INTO table_bookings (id, booking_reference, status, payment_status, updated_at) VALUES "
                    f"('{booking}', 'TB-2025', 'confirmed', 'pending', {old});")
    for i, row in enumerate(pending):
        rows.append(f"INSERT INTO pending_bookings (id, mobile_number, metadata, created_at) VALUES "
                    f"('{row}', '+4477009{i:05d}', '{{\"initial_sms\": \"Hi Sam\"}}', '2025-08-01');")
    rows.append(f"INSERT INTO short_links (id, short_code, destination_url, updated_at) VALUES "
                f"('{links[0]}', 'ugvve2', 'https://management.orangejelly.co.uk/g/tok1/card-capture', {old}),"
                f" ('{links[1]}', 'jhqcbq', 'https://management.orangejelly.co.uk/g/tok2/card-capture', {old});")

    # Look-alikes that must not change.
    rows.append(f"""
INSERT INTO table_bookings (id, booking_reference, status, payment_status, updated_at) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'TB-LIVE', 'pending_payment', 'pending', {old}),
  ('e0000000-0000-0000-0000-000000000002', 'TB-B1848E6A', 'confirmed', 'pending', {old}),
  ('e0000000-0000-0000-0000-000000000003', 'TB-W0001', 'confirmed', 'pending', {old}),
  ('e0000000-0000-0000-0000-000000000004', 'TB-UNMEASURED', 'confirmed', 'pending', {old});
INSERT INTO booking_holds (id, hold_type, table_booking_id, updated_at) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'payment_hold', 'e0000000-0000-0000-0000-000000000001', {old});
INSERT INTO payments (id, table_booking_id, charge_type, amount, status, updated_at) VALUES
  ('f0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', 'table_deposit', 150, 'pending', {old}),
  ('f0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000002', 'table_deposit', 70, 'pending', {old}),
  ('f0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000001', 'table_deposit', 150, 'failed', {old});
INSERT INTO short_links (id, short_code, destination_url, updated_at) VALUES
  ('f0000000-0000-0000-0000-000000000005', 'review', 'https://www.the-anchor.pub/review', {old});
""")
    return '\n'.join(rows), dict(consumed=consumed, released=released, payments=payments, no_deposit=no_deposit,
                                 pending=pending, links=links, paypal=paypal, partial=partial)


def main():
    text = MIGRATION.read_text()
    data, ids = fixture_rows(text)
    with tempfile.TemporaryDirectory(prefix='r28-tidy-pg-') as folder:
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

        def in_list(values):
            return "ARRAY[" + ', '.join(f"'{v}'" for v in values) + "]::uuid[]"

        def refuses(change, message, label):
            before = sql(SNAPSHOT)
            error = sql_error(f'BEGIN;\n{change}\n{text}\nCOMMIT;')
            if message not in error:
                raise RuntimeError(f'FAIL {label}: {error!r}')
            if sql(SNAPSHOT) != before:
                raise RuntimeError(f'FAIL {label}: a refused run changed something')
            print(f'PASS {label}')

        try:
            sql(SETUP)
            sql(data)
            baseline = sql(SNAPSHOT)

            check(f"(SELECT count(*) FROM booking_holds WHERE status = 'active' AND id = ANY ({in_list(ids['consumed'] + ids['released'])})) = 6"
                  f" AND (SELECT count(*) FROM payments WHERE status = 'pending' AND id = ANY ({in_list(ids['payments'])})) = 9"
                  f" AND (SELECT count(*) FROM table_bookings WHERE confirmed_at IS NULL AND id = ANY ({in_list(ids['paypal'])})) = 4"
                  " AND (SELECT count(*) FROM pending_bookings) = 48",
                  'baseline defect: 6 stale holds, 9 pending ledger rows, 4 paid bookings without a confirmed time, 48 retired rows')

            refuses(f"UPDATE booking_holds SET status = 'consumed' WHERE id = '{ids['consumed'][0]}';",
                    'expected 5 active holds on completed bookings, found 4', 'a hold that has moved on stops the whole migration')
            refuses(f"UPDATE payments SET status = 'succeeded' WHERE id = '{ids['payments'][0]}';",
                    'expected 9 pending table_deposit rows, found 8', 'a ledger row that has moved on stops the whole migration')
            refuses(f"UPDATE table_bookings SET confirmed_at = now() WHERE id = '{ids['paypal'][0]}';",
                    'expected 4 PayPal-paid bookings without a confirmed time, found 3', 'a confirmed time set since stops the whole migration')
            refuses(f"UPDATE table_bookings SET deposit_refund_status = 'refunded' WHERE id = '{ids['partial']}';",
                    'TB-CEDE872F is no longer completed and partly refunded', 'a changed refund stops the whole migration')
            refuses(f"UPDATE table_bookings SET deposit_amount = 70 WHERE id = '{ids['no_deposit'][0]}';",
                    'expected 26 confirmed bookings pending with no deposit, found 25', 'a booking that now owes a deposit stops the whole migration')
            refuses("INSERT INTO pending_bookings (id, mobile_number) VALUES (gen_random_uuid(), '+447700900999');",
                    'pending_bookings holds 49 rows, expected 48', 'a new pending_bookings row stops the whole migration')
            refuses("INSERT INTO short_links (id, short_code, destination_url) VALUES (gen_random_uuid(), 'zzz', 'https://x/g/t/card-capture');",
                    '3 short links point at card-capture, expected 2', 'a third card-capture link stops the whole migration')

            sql('BEGIN;\n' + text + '\nROLLBACK;')
            if sql(SNAPSHOT) != baseline:
                raise RuntimeError('FAIL a rolled-back run changed something')
            print('PASS a rolled-back run changes nothing')

            audits_before = int(sql('SELECT count(*) FROM audit_logs;'))
            sql('BEGIN;\n' + text + '\nCOMMIT;')

            check(f"(SELECT bool_and(status = 'consumed' AND consumed_at IS NOT NULL) FROM booking_holds WHERE id = ANY ({in_list(ids['consumed'])}))",
                  'the 5 holds on completed bookings are consumed')
            check(f"(SELECT status = 'released' AND released_at IS NOT NULL FROM booking_holds WHERE id = '{ids['released'][0]}')",
                  'the hold on the cancelled booking is released')
            check(f"(SELECT count(*) FROM audit_logs) = {audits_before + 6}", 'each hold change is audited')
            check(f"(SELECT bool_and(status = 'void' AND metadata ->> 'source' = 'foh_booking_create' AND metadata ? 'voided_reason')"
                  f" FROM payments WHERE id = ANY ({in_list(ids['payments'])}))", 'the 9 ledger rows are void, with their metadata kept and a note')
            check("(SELECT confirmed_at FROM table_bookings WHERE id = 'f922c595-f7ea-4177-a2f4-2eb21af968bd') = '2026-04-18 11:35:11+00'"
                  " AND (SELECT confirmed_at FROM table_bookings WHERE id = 'a66ed178-c0d1-4d1c-89b1-609fe7f23f59') = '2026-07-07 16:28:35.223+00'",
                  'the PayPal-paid bookings get the capture times')
            check(f"(SELECT payment_status = 'partial_refund' FROM table_bookings WHERE id = '{ids['partial']}')",
                  'TB-CEDE872F reads as partly refunded')
            check(f"(SELECT bool_and(payment_status IS NULL) FROM table_bookings WHERE id = ANY ({in_list(ids['no_deposit'])}))",
                  'the 26 bookings with no deposit no longer read as payment pending')
            check("(SELECT count(*) FROM pending_bookings) = 0", 'the 48 pending_bookings rows are gone')
            check(f"(SELECT bool_and(expires_at IS NOT NULL AND expires_at <= now()) FROM short_links WHERE id = ANY ({in_list(ids['links'])}))",
                  'the 2 card-capture links have expired')

            check("(SELECT status = 'active' FROM booking_holds WHERE id = 'f0000000-0000-0000-0000-000000000001')"
                  " AND (SELECT string_agg(status, ',' ORDER BY id) FROM payments WHERE id::text LIKE 'f0000000%') = 'pending,pending,failed'"
                  " AND (SELECT bool_and(payment_status = 'pending') FROM table_bookings WHERE id::text LIKE 'e0000000%' AND booking_reference <> 'TB-LIVE')"
                  " AND (SELECT expires_at IS NULL FROM short_links WHERE short_code = 'review')",
                  "no look-alike row is touched: the live booking's hold and deposit, the failed row, the booking still owed a deposit,"
                  " the walk-in, the unmeasured booking, the other short link")

            check("(SELECT count(*) FROM retired_row_values_20261027) = 47 AND (SELECT count(*) FROM retired_pending_bookings_20261027) = 48",
                  'the backups hold the old values of all 47 changed rows and the 48 deleted rows in full')
            for table in ('retired_row_values_20261027', 'retired_pending_bookings_20261027'):
                check(f"NOT has_table_privilege('anon', '{table}', 'SELECT') AND NOT has_table_privilege('authenticated', '{table}', 'SELECT')"
                      f" AND has_table_privilege('service_role', '{table}', 'SELECT') AND (SELECT relrowsecurity FROM pg_class WHERE relname = '{table}')",
                      f'{table} is service_role only with row level security on')
            error = sql_error("INSERT INTO payments (id, status) VALUES (gen_random_uuid(), 'lost');")
            if 'payments_status_check' not in error:
                raise RuntimeError(f'FAIL the payment status check no longer refuses unknown statuses: {error!r}')
            print('PASS the payment status check accepts void and still refuses anything unknown')

            error = sql_error('BEGIN;\n' + text + '\nCOMMIT;')
            if 'already exists' not in error:
                raise RuntimeError(f'FAIL a second run did not stop: {error!r}')
            print('PASS a second run stops at once and changes nothing')

            sql('BEGIN;\n' + ROLLBACK.read_text() + '\nCOMMIT;')
            if sql(SNAPSHOT) != baseline:
                raise RuntimeError('FAIL the rollback did not restore every value')
            print('PASS the rollback puts every value back exactly, updated_at included, and drops the backups')
            check(f"(SELECT count(*) FROM audit_logs) = {audits_before + 12}", 'the change back is audited too')
            error = sql_error("INSERT INTO payments (id, status) VALUES (gen_random_uuid(), 'void');")
            if 'payments_status_check' not in error:
                raise RuntimeError(f"FAIL the rollback left 'void' allowed: {error!r}")
            print("PASS the rollback restores the payment status check without 'void'")
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
