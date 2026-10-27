#!/usr/bin/env python3
"""Run the private-hire-close-out-atomic migration (review of release 13) in an isolated socket-only PostgreSQL database.

The fixture has production's private_bookings columns the close-out reads, its refund status and
post-event checks (after 20261027180212), payment_refunds and private_booking_payments with their
checks, the payment trigger that refuses a booking payment on an invoiced hire, and production's
record_balance_payment status guard. Against that baseline it shows the two defects: the old path
cannot record a balance on a completed hire, and its separate writes leave a deposit applied to the
bill when a later step fails. Then the migration runs and it proves:
- returning the deposit and settling the balance closes a confirmed hire, with every row written;
- a completed hire can be closed out, balance included;
- when any later part fails, nothing at all is left behind, so a retry starts clean;
- a repeat call after success is refused and applies nothing twice;
- an invoiced hire refuses the two parts that would write a booking payment, but its deposit can
  still be returned;
- a kept deposit needs a reason and a fitting amount, and a hire before its event is refused;
- the function is SECURITY DEFINER with search_path set, executable by service_role only.
It also checks that a rolled-back run changes nothing and that the rollback removes the function.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261027180246_private_hire_close_out_atomic.sql'
ROLLBACK = ROOT / 'tasks/private-hire-close-out-atomic/rollback.sql'

USER = '00000000-0000-4000-8000-0000000000aa'
CONFIRMED = '00000000-0000-4000-8000-000000000001'
COMPLETED = '00000000-0000-4000-8000-000000000002'
APPLY_FAILS = '00000000-0000-4000-8000-000000000003'
INVOICED = '00000000-0000-4000-8000-000000000004'
KEPT = '00000000-0000-4000-8000-000000000005'
FUTURE = '00000000-0000-4000-8000-000000000006'
INVOICE = '00000000-0000-4000-8000-0000000000ff'

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.private_bookings (
  id uuid PRIMARY KEY,
  status text,
  event_date date,
  deposit_amount numeric(10,2),
  deposit_paid_date timestamptz,
  deposit_payment_method text,
  invoice_id uuid,
  invoice_deposit_treatment text,
  deposit_refund_status text,
  post_event_status text,
  updated_at timestamptz,
  fixture_total numeric(10,2) NOT NULL DEFAULT 0,
  CONSTRAINT private_bookings_deposit_refund_status_check CHECK (deposit_refund_status = ANY (ARRAY[
    'partially_refunded'::text, 'refunded'::text, 'refund_due'::text,
    'retained'::text, 'partially_retained'::text, 'applied'::text])),
  CONSTRAINT private_bookings_post_event_status_check CHECK (((post_event_status IS NULL) OR (post_event_status = ANY (ARRAY[
    'awaiting_inspection'::text, 'inspection_complete'::text, 'deduction_discussion'::text, 'refund_processed'::text, 'complete'::text]))))
);
CREATE TABLE public.private_booking_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.private_bookings(id),
  amount numeric NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method = ANY (ARRAY['cash'::text, 'card'::text, 'invoice'::text])),
  notes text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type = ANY (ARRAY['private_booking'::text, 'table_booking'::text, 'parking'::text])),
  source_id uuid NOT NULL,
  paypal_capture_id text,
  refund_method text NOT NULL CHECK (refund_method = ANY (ARRAY['paypal'::text, 'cash'::text, 'bank_transfer'::text, 'other'::text])),
  amount numeric NOT NULL CHECK (amount > 0),
  original_amount numeric NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text])),
  initiated_by uuid,
  initiated_by_type text NOT NULL DEFAULT 'staff' CHECK (initiated_by_type = ANY (ARRAY['staff'::text, 'system'::text])),
  notification_status text CHECK (notification_status = ANY (ARRAY['email_sent'::text, 'sms_sent'::text, 'skipped'::text, 'failed'::text])),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.private_booking_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.private_bookings(id),
  action text NOT NULL, field_name text, old_value text, new_value text,
  metadata jsonb DEFAULT '{}'::jsonb, performed_by uuid, performed_at timestamptz NOT NULL DEFAULT now()
);

-- The balance: the fixture total less what has been paid on the booking.
CREATE FUNCTION public.calculate_private_booking_balance(p_booking_id uuid) RETURNS numeric LANGUAGE sql AS $$
  SELECT GREATEST(0, b.fixture_total - COALESCE((SELECT SUM(amount) FROM public.private_booking_payments p WHERE p.booking_id = b.id), 0))
  FROM public.private_bookings b WHERE b.id = p_booking_id $$;

-- Production's guard: an invoiced hire's payments go on the invoice. And a fixture switch that
-- makes the balance write fail, to prove a failure part-way leaves nothing behind.
CREATE FUNCTION public.guard_private_booking_payment_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.private_bookings WHERE id = NEW.booking_id AND invoice_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Select invoice allocations for this payment';
  END IF;
  IF NEW.notes LIKE 'Settled at the till%' AND current_setting('fixture.fail_balance', true) = 'on' THEN
    RAISE EXCEPTION 'fixture: the balance write failed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER private_booking_payment_settlement_guard BEFORE INSERT ON public.private_booking_payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_private_booking_payment_settlement();

-- Production's record_balance_payment status guard (20260905192946, line 338), the old path.
CREATE FUNCTION public.record_balance_payment(p_booking_id uuid, p_amount numeric, p_method text, p_recorded_by uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.private_bookings WHERE id = p_booking_id FOR UPDATE;
  IF v_status IN ('cancelled', 'completed') THEN RAISE EXCEPTION 'Cannot record payment on a % booking', v_status; END IF;
  INSERT INTO public.private_booking_payments(booking_id, amount, method, recorded_by) VALUES (p_booking_id, p_amount, p_method, p_recorded_by);
  RETURN '{}'::jsonb;
END $$;

CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
"""

SEED = f"""
TRUNCATE public.private_booking_audit, public.payment_refunds, public.private_booking_payments;
DELETE FROM public.private_bookings;
INSERT INTO public.private_bookings (id, status, event_date, deposit_amount, deposit_paid_date, deposit_payment_method,
  invoice_id, invoice_deposit_treatment, deposit_refund_status, post_event_status, fixture_total) VALUES
 ('{CONFIRMED}', 'confirmed', current_date - 3, 250, now() - interval '60 days', 'cash', NULL, NULL, NULL, 'awaiting_inspection', 640),
 ('{COMPLETED}', 'completed', current_date - 3, 0, NULL, NULL, NULL, NULL, NULL, NULL, 400),
 ('{APPLY_FAILS}', 'confirmed', current_date - 3, 250, now() - interval '60 days', 'paypal', NULL, NULL, NULL, 'awaiting_inspection', 640),
 ('{INVOICED}', 'confirmed', current_date - 3, 250, now() - interval '60 days', 'cash', '{INVOICE}', 'held_separately', NULL, 'awaiting_inspection', 640),
 ('{KEPT}', 'confirmed', current_date - 3, 250, now() - interval '60 days', 'cash', NULL, NULL, NULL, 'awaiting_inspection', 0),
 ('{FUTURE}', 'confirmed', current_date + 5, 250, now() - interval '60 days', 'cash', NULL, NULL, NULL, NULL, 640);
"""


def main():
    with tempfile.TemporaryDirectory(prefix='r13-close-pg-') as folder:
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

        def refused(value, needle, label):
            error = sql_error(value)
            if needle not in error:
                raise RuntimeError(f'FAIL {label}: expected {needle!r}, got {error!r}')
            print(f'PASS {label}')

        def close(booking, balance='NULL', outcome='NULL', method='NULL', kept='NULL', reason='NULL'):
            return (f"SELECT balance_recorded || ':' || coalesce(deposit_status, '-') || ':' || deposit_handled "
                    f"FROM public.close_out_private_booking('{booking}', {balance}, {outcome}, {method}, {kept}, {reason}, '{USER}');")

        def counts(booking):
            return sql(f"SELECT (SELECT count(*) FROM public.private_booking_payments WHERE booking_id = '{booking}') || '/' || "
                       f"(SELECT count(*) FROM public.payment_refunds WHERE source_id = '{booking}') || '/' || "
                       f"(SELECT count(*) FROM public.private_booking_audit WHERE booking_id = '{booking}') || '/' || "
                       f"(SELECT status || ':' || coalesce(deposit_refund_status, '-') || ':' || coalesce(post_event_status, '-') FROM public.private_bookings WHERE id = '{booking}');")

        try:
            sql(SETUP)
            sql(SEED)

            # Baseline: the old path's two defects.
            refused(f"SELECT public.record_balance_payment('{COMPLETED}', 400, 'card', '{USER}');",
                    'Cannot record payment on a completed booking', 'baseline defect: the old path cannot settle a completed hire')
            # The old app wrote the applied deposit first, then the balance; when the balance write
            # failed the first write stayed, with the deposit still open.
            sql(f"SELECT public.record_balance_payment('{APPLY_FAILS}', 250, 'card', '{USER}');")
            sql("SET fixture.fail_balance = 'on';")
            error = sql_error(f"SET fixture.fail_balance = 'on'; INSERT INTO public.private_booking_payments(booking_id, amount, method, notes) VALUES ('{APPLY_FAILS}', 390, 'card', 'Settled at the till');")
            if 'the balance write failed' not in error: raise RuntimeError(f'FAIL fixture switch: {error!r}')
            check(f"(SELECT count(*) = 1 FROM public.private_booking_payments WHERE booking_id = '{APPLY_FAILS}') "
                  f"AND (SELECT deposit_refund_status IS NULL FROM public.private_bookings WHERE id = '{APPLY_FAILS}')",
                  'baseline defect: separate writes leave the deposit applied with the booking still showing it open')
            refused("SELECT 'public.close_out_private_booking(uuid,text,text,text,numeric,text,uuid)'::regprocedure;",
                    'does not exist', 'baseline: there is no close-out function')

            sql(SEED)
            before = '|'.join(counts(b) for b in (CONFIRMED, COMPLETED, APPLY_FAILS, INVOICED, KEPT, FUTURE))
            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            after = '|'.join(counts(b) for b in (CONFIRMED, COMPLETED, APPLY_FAILS, INVOICED, KEPT, FUTURE))
            if before != after or sql("SELECT to_regprocedure('public.close_out_private_booking(uuid,text,text,text,numeric,text,uuid)') IS NULL;") != 't':
                raise RuntimeError('FAIL a rolled-back run changed something')
            print('PASS a rolled-back run changes nothing')

            sql(MIGRATION.read_text())

            # Returned at the till, balance settled at the till: every row, and the hire closed.
            out = sql(close(CONFIRMED, "'card'", "'returned'", "'cash'"))
            if out != '640.00:refunded:250.00': raise RuntimeError(f'FAIL returned result {out!r}')
            check(f"(SELECT count(*) = 1 AND sum(amount) = 640 AND min(method) = 'card' FROM public.private_booking_payments WHERE booking_id = '{CONFIRMED}')",
                  'the balance is recorded as settled at the till')
            check(f"(SELECT count(*) = 1 AND min(amount) = 250 AND min(refund_method) = 'cash' AND min(status) = 'completed' AND min(notification_status) = 'skipped' "
                  f"FROM public.payment_refunds WHERE source_id = '{CONFIRMED}')", 'the deposit is recorded as returned at the till, with no notice to the guest')
            check(f"(SELECT status = 'completed' AND post_event_status = 'complete' AND deposit_refund_status = 'refunded' FROM public.private_bookings WHERE id = '{CONFIRMED}')",
                  'the hire is completed and its post-event step closed')
            check(f"(SELECT action = 'closed_out' AND new_value = 'completed' AND metadata ? 'deposit' AND metadata ? 'balance' FROM public.private_booking_audit WHERE booking_id = '{CONFIRMED}')",
                  'the close-out is audited on the booking')

            # A repeat call after success applies nothing twice.
            refused(close(CONFIRMED, "'card'", "'returned'", "'cash'"), 'no deposit left to close', 'a repeat close-out is refused')
            check(f"(SELECT count(*) = 1 FROM public.payment_refunds WHERE source_id = '{CONFIRMED}') AND "
                  f"(SELECT count(*) = 1 FROM public.private_booking_payments WHERE booking_id = '{CONFIRMED}')",
                  'and records no second refund or payment')

            # A completed hire with no deposit can have its balance settled at the till.
            out = sql(close(COMPLETED, "'cash'"))
            if out != '400.00:-:0': raise RuntimeError(f'FAIL completed result {out!r}')
            check(f"(SELECT sum(amount) = 400 FROM public.private_booking_payments WHERE booking_id = '{COMPLETED}')",
                  'a completed hire can be closed out, balance included')

            # A failure part-way leaves nothing behind, so a retry starts clean and applies once.
            refused("SET fixture.fail_balance = 'on'; " + close(APPLY_FAILS, "'card'", "'applied'"),
                    'the balance write failed', 'a close-out whose balance write fails is refused')
            if counts(APPLY_FAILS) != '0/0/0/confirmed:-:awaiting_inspection':
                raise RuntimeError(f'FAIL a failed close-out left something behind: {counts(APPLY_FAILS)}')
            print('PASS a close-out that fails part-way leaves nothing behind: no applied deposit, the booking unchanged')
            out = sql(close(APPLY_FAILS, "'card'", "'applied'"))
            if out != '390.00:applied:250.00': raise RuntimeError(f'FAIL applied result {out!r}')
            check(f"(SELECT count(*) = 2 AND sum(amount) = 640 FROM public.private_booking_payments WHERE booking_id = '{APPLY_FAILS}') AND "
                  f"(SELECT deposit_refund_status = 'applied' AND status = 'completed' FROM public.private_bookings WHERE id = '{APPLY_FAILS}')",
                  'the retry applies the deposit once and settles the rest')
            check(f"(SELECT method = 'card' FROM public.private_booking_payments WHERE booking_id = '{APPLY_FAILS}' AND notes LIKE 'Deposit%')",
                  'a PayPal deposit put against the bill is recorded as a card payment')

            # An invoiced hire: its payments belong on the invoice.
            refused(close(INVOICED, 'NULL', "'applied'"), 'put the deposit against the invoice', 'an invoiced hire refuses a deposit put against the bill')
            refused(close(INVOICED, "'card'", "'returned'", "'cash'"), 'record the balance as a payment on its invoice',
                    'an invoiced hire refuses the balance tick')
            if counts(INVOICED) != '0/0/0/confirmed:-:awaiting_inspection':
                raise RuntimeError(f'FAIL a refused invoiced close-out left something: {counts(INVOICED)}')
            print('PASS and a refused one leaves no refund behind')
            out = sql(close(INVOICED, 'NULL', "'returned'", "'card'"))
            if out != '0.00:refunded:250.00': raise RuntimeError(f'FAIL invoiced returned result {out!r}')
            check(f"(SELECT min(refund_method) = 'other' FROM public.payment_refunds WHERE source_id = '{INVOICED}')",
                  'an invoiced hire can still have its deposit returned, by card recorded as other')

            # A kept deposit.
            refused(close(KEPT, 'NULL', "'kept'", "'card'", '100', "' '"), 'record why the deposit was kept', 'keeping a deposit needs a reason')
            refused(close(KEPT, 'NULL', "'kept'", "'card'", '300', "'Damage'"), 'between £0.01 and £250.00', 'keeping more than the deposit is refused')
            refused(close(KEPT, 'NULL', "'kept'", 'NULL', '100', "'Damage'"), 'how the rest of the deposit was returned', 'keeping part needs to say how the rest went back')
            out = sql(close(KEPT, 'NULL', "'kept'", "'card'", '100', "'Broken table'"))
            if out != '0.00:partially_retained:250.00': raise RuntimeError(f'FAIL kept result {out!r}')
            check(f"(SELECT min(amount) = 150 FROM public.payment_refunds WHERE source_id = '{KEPT}')",
                  'keeping part records the rest as returned')

            refused(close(FUTURE, 'NULL', "'returned'", "'cash'"), 'on or after the day of the event', 'a hire before its event is refused')
            refused(close(FUTURE, 'NULL'), 'on or after the day of the event', 'and so is one with nothing to record')

            check("(SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_catalog'] FROM pg_proc WHERE oid = "
                  "'public.close_out_private_booking(uuid,text,text,text,numeric,text,uuid)'::regprocedure)",
                  'the function is SECURITY DEFINER with search_path set')
            check("has_function_privilege('service_role', 'public.close_out_private_booking(uuid,text,text,text,numeric,text,uuid)', 'EXECUTE') "
                  "AND NOT has_function_privilege('authenticated', 'public.close_out_private_booking(uuid,text,text,text,numeric,text,uuid)', 'EXECUTE') "
                  "AND NOT has_function_privilege('anon', 'public.close_out_private_booking(uuid,text,text,text,numeric,text,uuid)', 'EXECUTE')",
                  'only service_role can call it')

            sql(ROLLBACK.read_text())
            check("to_regprocedure('public.close_out_private_booking(uuid,text,text,text,numeric,text,uuid)') IS NULL",
                  'the rollback removes the function')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
