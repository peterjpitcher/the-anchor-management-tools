#!/usr/bin/env python3
"""Run the online-income migration in an isolated socket-only PostgreSQL database.

Fixture tables carry the columns the view reads from each place production records online money
(checked 26 October 2026): table and private-hire deposits on the booking, event tickets, historic
Stripe deposits and manual door money in payments, refunds in payment_refunds and payments,
PayPal and copied invoice payments in invoice_payments, and parking payments. Supabase's default
privileges are reproduced, so the migration's own revokes do the work.

Baseline: nothing lists money taken online. A rolled-back run creates nothing. Then the migration
runs and the view must agree with each source table (the parity check BK-117 asks for): every
online payment once, door money and invoice copies left out, refunds subtracted, the right status,
London dates, PayPal fees joined by capture id, and a private hire's invoice marked as booking
money. anon and authenticated reach neither object; service_role reaches both. The migration's
assertion catches a re-grant, and the rollback leaves the database as production had it.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261026234203_online_income.sql'
ROLLBACK = ROOT / 'tasks/online-income/rollback.sql'

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

CREATE TABLE public.events (id uuid PRIMARY KEY, name text, date date);
CREATE TABLE public.bookings (id uuid PRIMARY KEY, event_id uuid REFERENCES public.events(id), status text);
CREATE TABLE public.table_bookings (
  id uuid PRIMARY KEY, booking_reference varchar, booking_date date, status text,
  paypal_deposit_capture_id text, deposit_amount numeric, deposit_amount_locked numeric,
  card_capture_completed_at timestamptz, confirmed_at timestamptz, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_booking_id uuid, table_booking_id uuid,
  charge_type text, payment_provider text, payment_method text, amount numeric, status text,
  refund_amount numeric, paypal_capture_id text, stripe_payment_intent_id text, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_type text, source_id uuid, amount numeric, status text
);
CREATE TABLE public.private_bookings (
  id uuid PRIMARY KEY, status text, event_type text, event_date date, deposit_amount numeric,
  deposit_paid_date timestamptz, deposit_payment_method text, paypal_deposit_capture_id text,
  invoice_deposit_treatment text, invoice_id uuid
);
CREATE TABLE public.invoices (id uuid PRIMARY KEY, invoice_number varchar, deleted_at timestamptz);
CREATE TABLE public.invoice_payments (
  id uuid PRIMARY KEY, invoice_id uuid REFERENCES public.invoices(id), payment_date date, amount numeric,
  reference varchar, source_kind text
);
CREATE TABLE public.private_booking_invoices (booking_id uuid, invoice_id uuid, kind text);
CREATE TABLE public.parking_bookings (id uuid PRIMARY KEY, reference text, start_at timestamptz);
CREATE TABLE public.parking_booking_payments (
  id uuid PRIMARY KEY, booking_id uuid REFERENCES public.parking_bookings(id), provider text, status text,
  amount numeric, transaction_id text, paid_at timestamptz, refund_status text, created_at timestamptz DEFAULT now()
);

-- Events: one past (tickets earned), one far in the future (tickets held).
INSERT INTO public.events VALUES
  ('e0000000-0000-0000-0000-000000000001', 'Quiz night', DATE '2026-07-04'),
  ('e0000000-0000-0000-0000-000000000002', 'Tinsel and Tipples', DATE '2099-11-20');
INSERT INTO public.bookings VALUES
  ('b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'completed'),
  ('b0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002', 'confirmed'),
  ('b0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000001', 'confirmed');
-- Ticket b1: paid 23:30 UTC on 4 July (00:30 on 5 July in London), then more seats, then a part refund.
INSERT INTO public.payments (event_booking_id, charge_type, payment_provider, amount, status, paypal_capture_id, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'prepaid_event', 'paypal', 40, 'succeeded', 'CAP-T1', '2026-07-04 23:30:00+00'),
  ('b0000000-0000-0000-0000-000000000001', 'seat_increase', 'paypal', 20, 'succeeded', 'CAP-T1B', '2026-07-05 10:00:00+00'),
  ('b0000000-0000-0000-0000-000000000001', 'refund', 'paypal', 15, 'succeeded', NULL, '2026-07-06 10:00:00+00'),
  ('b0000000-0000-0000-0000-000000000001', 'refund', 'paypal', 99, 'pending', NULL, '2026-07-06 11:00:00+00'),
  ('b0000000-0000-0000-0000-000000000002', 'prepaid_event', 'paypal', 45, 'succeeded', 'CAP-T2', '2026-10-01 12:00:00+00'),
  ('b0000000-0000-0000-0000-000000000002', 'prepaid_event', 'paypal', 45, 'failed', 'CAP-T2X', '2026-10-01 11:00:00+00'),
  -- Door money taken by hand is in the till already: never online income.
  ('b0000000-0000-0000-0000-000000000003', 'prepaid_event', 'manual', 20, 'succeeded', NULL, '2026-07-04 19:00:00+00');

-- Table deposits: PayPal ones on the booking, a historic Stripe one in payments, and the pending
-- ledger row production writes for every deposit booking (never money).
INSERT INTO public.table_bookings (id, booking_reference, booking_date, status, paypal_deposit_capture_id, deposit_amount, deposit_amount_locked, card_capture_completed_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'TB-APPLIED', DATE '2026-08-01', 'completed', 'CAP-D1', 160, 160, '2026-07-20 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000002', 'TB-KEPT', DATE '2026-08-02', 'no_show', 'CAP-D2', 150, NULL, '2026-07-21 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'TB-HELD', DATE '2099-12-12', 'confirmed', 'CAP-D3', 60, 60, '2026-10-20 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'TB-PART', DATE '2026-04-30', 'completed', 'CAP-D4', 80, 80, '2026-04-23 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'TB-STRIPE', DATE '2026-03-14', 'cancelled', NULL, 40, NULL, NULL),
  ('a0000000-0000-0000-0000-000000000006', 'TB-UNPAID', DATE '2026-09-01', 'cancelled', NULL, 150, NULL, NULL);
INSERT INTO public.payments (table_booking_id, charge_type, payment_provider, amount, status, stripe_payment_intent_id, created_at) VALUES
  ('a0000000-0000-0000-0000-000000000005', 'table_deposit', 'stripe', 40, 'succeeded', 'pi_1', '2026-03-13 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'table_deposit', NULL, 150, 'pending', NULL, '2026-08-20 10:00:00+00');
INSERT INTO public.payment_refunds (source_type, source_id, amount, status) VALUES
  ('table_booking', 'a0000000-0000-0000-0000-000000000004', 50.25, 'completed'),
  ('table_booking', 'a0000000-0000-0000-0000-000000000001', 160, 'failed'),
  ('private_booking', 'c0000000-0000-0000-0000-000000000003', 250, 'completed'),
  ('parking', 'f0000000-0000-0000-0000-000000000002', 70, 'completed');

-- Private hire: PayPal deposits only (a card deposit taken in person is not online).
INSERT INTO public.private_bookings (id, status, event_type, event_date, deposit_amount, deposit_paid_date, deposit_payment_method, paypal_deposit_capture_id, invoice_deposit_treatment, invoice_id) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'completed', 'Christening', DATE '2026-09-26', 250, '2026-09-01 10:00:00+00', 'paypal', 'CAP-P1', 'deducted', 'd0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000002', 'cancelled', 'Birthday', DATE '2026-07-04', 350, '2026-05-14 10:00:00+00', 'paypal', 'CAP-P2', NULL, NULL),
  ('c0000000-0000-0000-0000-000000000003', 'completed', 'Wake', DATE '2026-09-20', 250, '2026-09-14 10:00:00+00', 'paypal', 'CAP-P3', 'held_separately', NULL),
  ('c0000000-0000-0000-0000-000000000004', 'confirmed', 'Christmas party', DATE '2099-12-18', 250, '2026-10-10 10:00:00+00', 'paypal', 'CAP-P4', NULL, NULL),
  ('c0000000-0000-0000-0000-000000000005', 'confirmed', 'Wedding', DATE '2026-11-21', 500, '2026-10-01 10:00:00+00', 'card', NULL, NULL, NULL);

-- Invoices: a private hire's PayPal payment, one for no booking, a copied deposit (never new
-- money) and a payment on a deleted invoice.
INSERT INTO public.invoices VALUES
  ('d0000000-0000-0000-0000-000000000001', 'INV-HIRE', NULL),
  ('d0000000-0000-0000-0000-000000000002', 'INV-OTHER', NULL),
  ('d0000000-0000-0000-0000-000000000003', 'INV-GONE', '2026-09-30 10:00:00+00'),
  ('d0000000-0000-0000-0000-000000000004', 'INV-LINKED', NULL);
INSERT INTO public.private_booking_invoices VALUES ('c0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000004', 'supplementary');
INSERT INTO public.invoice_payments VALUES
  ('90000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', DATE '2026-10-05', 950, 'CAP-I1', 'paypal'),
  ('90000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', DATE '2026-09-21', 420, 'CAP-I2', 'paypal'),
  ('90000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001', DATE '2026-09-01', 250, NULL, 'booking_deposit'),
  ('90000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000003', DATE '2026-09-02', 100, 'CAP-I3', 'paypal'),
  ('90000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000004', DATE '2026-10-12', 30, 'CAP-I4', 'paypal');

-- Parking: paid, refunded, and an unpaid order that expired.
INSERT INTO public.parking_bookings VALUES
  ('e1000000-0000-0000-0000-000000000001', 'PAR-1', '2026-06-02 08:00:00+00'),
  ('e1000000-0000-0000-0000-000000000002', 'PAR-2', '2026-06-09 08:00:00+00'),
  ('e1000000-0000-0000-0000-000000000003', 'PAR-3', '2026-06-10 08:00:00+00');
INSERT INTO public.parking_booking_payments (id, booking_id, provider, status, amount, transaction_id, paid_at, refund_status) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'paypal', 'paid', 75, 'CAP-K1', '2026-06-01 09:00:00+00', NULL),
  ('f0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'paypal', 'refunded', 70, 'CAP-K2', '2026-06-01 09:30:00+00', 'refunded'),
  ('f0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000003', 'paypal', 'expired', 80, NULL, NULL, NULL);

CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
GRANT EXECUTE ON FUNCTION fixture_assert(boolean,text) TO PUBLIC;
"""

ROW = "(SELECT {col} FROM public.online_income_movements WHERE {where})"


def main():
    with tempfile.TemporaryDirectory(prefix='bk117-pg-') as folder:
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

        def refused(statement, needle, label):
            error = sql_error(f'BEGIN; {statement}; ROLLBACK;')
            if needle not in error:
                raise RuntimeError(f'FAIL {label}: {error!r}')
            print(f'PASS {label}')

        def objects():
            return sql("SELECT coalesce(string_agg(relname || ':' || relkind::text, ',' ORDER BY relname), '') FROM pg_class "
                       "WHERE relnamespace = 'public'::regnamespace AND relname IN ('online_income_movements', 'paypal_capture_fees');")

        try:
            sql(SETUP)
            check("to_regclass('public.online_income_movements') IS NULL",
                  'baseline defect: nothing lists the money taken online')
            baseline = objects()

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if objects() != baseline:
                raise RuntimeError('FAIL a rolled-back run left something behind')
            print('PASS a rolled-back run changes nothing')

            sql(MIGRATION.read_text())
            sql("INSERT INTO public.paypal_capture_fees (capture_id, fee_amount, gross_amount, net_amount, source) "
                "VALUES ('CAP-D1', 5.42, 160, 154.58, 'test');")

            # Parity with each source table, worked out independently of the view.
            check("(SELECT sum(gross) FROM public.online_income_movements WHERE source = 'table_deposit' AND method = 'paypal') = "
                  "(SELECT sum(coalesce(deposit_amount_locked, deposit_amount)) FROM public.table_bookings WHERE paypal_deposit_capture_id IS NOT NULL)",
                  'parity: table deposits taken by PayPal match the bookings that carry a capture')
            check("(SELECT sum(gross) FROM public.online_income_movements WHERE source = 'table_deposit' AND method = 'stripe') = "
                  "(SELECT sum(amount) FROM public.payments WHERE charge_type = 'table_deposit' AND payment_provider = 'stripe' AND status = 'succeeded')",
                  'parity: historic Stripe deposits match the payments ledger')
            check("(SELECT sum(gross) FROM public.online_income_movements WHERE source = 'private_hire_deposit') = "
                  "(SELECT sum(deposit_amount) FROM public.private_bookings WHERE deposit_payment_method = 'paypal' AND deposit_paid_date IS NOT NULL)",
                  'parity: private-hire deposits match the PayPal-paid bookings')
            check("(SELECT sum(gross) FROM public.online_income_movements WHERE source = 'event_ticket') = "
                  "(SELECT sum(amount) FROM public.payments WHERE payment_provider = 'paypal' AND charge_type IN ('prepaid_event', 'seat_increase') AND status = 'succeeded')",
                  'parity: event tickets match the succeeded PayPal charges')
            check("(SELECT sum(gross) FROM public.online_income_movements WHERE source = 'invoice') = "
                  "(SELECT sum(ip.amount) FROM public.invoice_payments ip JOIN public.invoices i ON i.id = ip.invoice_id WHERE ip.source_kind = 'paypal' AND i.deleted_at IS NULL)",
                  'parity: invoice payments match the PayPal ones on live invoices')
            check("(SELECT sum(gross) FROM public.online_income_movements WHERE source = 'parking') = "
                  "(SELECT sum(amount) FROM public.parking_booking_payments WHERE provider = 'paypal' AND status IN ('paid', 'refunded'))",
                  'parity: parking matches the paid and refunded PayPal payments')
            check("(SELECT count(*) = 16 FROM public.online_income_movements)", 'every online payment is listed once')

            check("NOT EXISTS (SELECT 1 FROM public.online_income_movements WHERE source_id = 'b0000000-0000-0000-0000-000000000003')",
                  'door money recorded by hand is left out (it is in the till)')
            check("NOT EXISTS (SELECT 1 FROM public.online_income_movements WHERE source_id IN ('90000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000004'))",
                  'an invoice copy of a deposit and a deleted invoice are left out')
            check("NOT EXISTS (SELECT 1 FROM public.online_income_movements WHERE booking_reference = 'TB-UNPAID' OR source_id = 'c0000000-0000-0000-0000-000000000005')",
                  'an unpaid pending ledger row and a card deposit taken in person are left out')

            check(ROW.format(col="(gross, refunded, net, money_date, status)::text",
                             where="source_id = 'b0000000-0000-0000-0000-000000000001'") + " = '(60.00,15.00,45.00,2026-07-05,part_refunded)'",
                  'a ticket booking is one row: charges added, succeeded refunds taken off, dated in London')
            check(ROW.format(col="status", where="source_id = 'b0000000-0000-0000-0000-000000000002'") + " = 'held'",
                  'tickets for a night still to come are held')
            check(ROW.format(col="(status, paypal_fee)::text", where="booking_reference = 'TB-APPLIED'") + " = '(applied,5.42)'",
                  'a deposit for a past visit is applied to the bill, with its PayPal fee')
            # Booking b...1 paid in two captures: the tickets (CAP-T1) and a seat increase (CAP-T1B).
            sql("INSERT INTO public.paypal_capture_fees (capture_id, fee_amount, source) VALUES ('CAP-T1', 1.50, 'test');")
            check(ROW.format(col="paypal_fee", where="source = 'event_ticket' AND source_id = 'b0000000-0000-0000-0000-000000000001'") + " IS NULL",
                  'an event booking with one capture fee missing has an unknown fee, not the first capture alone')
            sql("INSERT INTO public.paypal_capture_fees (capture_id, fee_amount, source) VALUES ('CAP-T1B', 0.90, 'test');")
            check(ROW.format(col="paypal_fee", where="source = 'event_ticket' AND source_id = 'b0000000-0000-0000-0000-000000000001'") + " = 2.40",
                  'an event booking paid in two captures carries both fees added up')
            check(ROW.format(col="(gross, status)::text", where="booking_reference = 'TB-KEPT'") + " = '(150.00,kept)'",
                  'a no-show keeps its deposit, read from deposit_amount when nothing was locked')
            check(ROW.format(col="status", where="booking_reference = 'TB-HELD'") + " = 'held'", 'a deposit for a visit to come is held')
            check(ROW.format(col="(refunded, net, status)::text", where="booking_reference = 'TB-PART'") + " = '(50.25,29.75,part_refunded)'",
                  'a part refund from payment_refunds is taken off; a failed one is not')
            check(ROW.format(col="(status, method)::text", where="booking_reference = 'TB-STRIPE'") + " = '(kept,stripe)'",
                  'a historic Stripe deposit on a cancelled booking reads as kept')
            check(ROW.format(col="status", where="source_id = 'c0000000-0000-0000-0000-000000000001'") + " = 'applied'",
                  'a hire deposit deducted from the invoice is applied')
            check(ROW.format(col="status", where="source_id = 'c0000000-0000-0000-0000-000000000002'") + " = 'kept'",
                  'a cancelled hire keeps its deposit when nothing was refunded')
            check(ROW.format(col="(net, status)::text", where="source_id = 'c0000000-0000-0000-0000-000000000003'") + " = '(0.00,refunded)'",
                  'a refunded hire deposit nets to nothing')
            check(ROW.format(col="status", where="source_id = 'c0000000-0000-0000-0000-000000000004'") + " = 'held'",
                  'a hire still to come holds its deposit')
            check(ROW.format(col="is_booking_money", where="booking_reference = 'INV-HIRE'")
                  + " AND " + ROW.format(col="is_booking_money", where="booking_reference = 'INV-LINKED'")
                  + " AND NOT " + ROW.format(col="is_booking_money", where="booking_reference = 'INV-OTHER'"),
                  'a private hire invoice is booking money; an invoice for no booking is not')
            check(ROW.format(col="(net, status)::text", where="booking_reference = 'PAR-2'") + " = '(0.00,refunded)'",
                  'a refunded parking payment nets to nothing')

            for role in ('anon', 'authenticated'):
                refused(f"SET ROLE {role}; SELECT * FROM public.online_income_movements",
                        'permission denied for view online_income_movements', f'{role} cannot read the view')
                refused(f"SET ROLE {role}; SELECT * FROM public.paypal_capture_fees",
                        'permission denied for table paypal_capture_fees', f'{role} cannot read the fees')
            sql("SET ROLE service_role; SELECT fixture_assert((SELECT count(*) = 16 FROM public.online_income_movements), "
                "'service_role reads the view'); RESET ROLE;")
            refused("INSERT INTO public.paypal_capture_fees (capture_id, fee_amount, source) VALUES ('CAP-X', -1, 'test')",
                    'paypal_capture_fees_fee_amount_check', 'a negative fee is refused')

            assertion = MIGRATION.read_text().split('-- Prove it,', 1)[1].split('\n', 1)[1]
            error = sql_error('BEGIN; GRANT SELECT ON public.online_income_movements TO authenticated;\n' + assertion + '\nROLLBACK;')
            if 'reachable by anon or authenticated' not in error:
                raise RuntimeError(f'FAIL the assertion did not catch a re-grant: {error!r}')
            print('PASS the migration assertion fails on a re-granted view')

            sql(ROLLBACK.read_text())
            if objects() != baseline:
                raise RuntimeError('FAIL the rollback left something behind')
            print('PASS the rollback leaves the database as production had it')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
