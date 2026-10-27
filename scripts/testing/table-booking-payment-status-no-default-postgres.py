#!/usr/bin/env python3
"""Run the table booking payment status default migration in an isolated socket-only PostgreSQL database.

BK-050: the FOH walk-in fallback and the super admin override insert table_bookings rows directly
without naming a payment status, and the column default of 'pending' made each one read as owing a
deposit. This loads table_bookings with production's defaults for the two columns, shows the defect
(an insert shaped like the FOH one is saved 'pending'), then runs the migration and checks:

  - a rolled-back run changes nothing;
  - the FOH-shaped insert is now saved with no payment status, and an insert that forgets the
    status fails instead of creating a booking that looks unpaid;
  - the backfill clears 'pending' from moneyless walk-in and override bookings only, leaving a
    walk-in with a capture, a locked deposit or a payments row, and every ordinary booking, alone;
  - a second run is a no-op;
  - the rollback restores both defaults and puts 'pending' back on the rows it lists.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261027133206_table_booking_payment_status_no_default.sql'
ROLLBACK = ROOT / 'tasks/table-booking-payment-status-no-default/rollback.sql'

# Two of the ids the rollback lists, so the harness can see it restore them.
LISTED_WALK_IN = '4da4efc5-e3df-416e-839c-5c01ecbb246d'
LISTED_OVERRIDE = '26e3adc8-597c-40da-88b6-a46204b3e88c'

SETUP = f"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE public.table_booking_status AS ENUM ('pending_payment', 'confirmed', 'cancelled', 'no_show', 'completed',
  'pending_card_capture', 'visited_waiting_for_review', 'review_clicked');
CREATE TYPE public.payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded', 'partial_refund');
-- Production's columns for what the migration reads, with production's defaults (26 October 2026).
CREATE TABLE public.table_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_reference varchar NOT NULL,
  status public.table_booking_status NOT NULL DEFAULT 'pending_payment'::public.table_booking_status,
  payment_status public.payment_status DEFAULT 'pending'::public.payment_status,
  party_size integer NOT NULL DEFAULT 2,
  source varchar DEFAULT 'website',
  paypal_deposit_capture_id text,
  deposit_amount_locked numeric);
CREATE TABLE public.payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_booking_id uuid, amount numeric);

-- The rows the backfill must and must not touch, as production holds them.
INSERT INTO public.table_bookings (id, booking_reference, status, party_size, source) VALUES
  ('{LISTED_WALK_IN}', 'TB-W0000001', 'confirmed', 4, 'walk-in'),
  ('{LISTED_OVERRIDE}', 'TB-W0000002', 'cancelled', 20, 'management'),
  ('00000000-0000-4000-8000-000000000003', 'TB-W0000003', 'completed', 2, 'walk-in');
INSERT INTO public.table_bookings (id, booking_reference, status, party_size, source, paypal_deposit_capture_id) VALUES
  ('00000000-0000-4000-8000-000000000004', 'TB-W0000004', 'confirmed', 16, 'walk-in', 'CAPTURE-1');
INSERT INTO public.table_bookings (id, booking_reference, status, party_size, source, deposit_amount_locked) VALUES
  ('00000000-0000-4000-8000-000000000005', 'TB-W0000005', 'confirmed', 16, 'walk-in', 160);
INSERT INTO public.table_bookings (id, booking_reference, status, party_size, source) VALUES
  ('00000000-0000-4000-8000-000000000006', 'TB-W0000006', 'confirmed', 16, 'walk-in'),
  ('00000000-0000-4000-8000-000000000007', 'TB-ABCDEF01', 'pending_payment', 16, 'brand_site');
INSERT INTO public.payments (table_booking_id, amount) VALUES ('00000000-0000-4000-8000-000000000006', 160);

CREATE FUNCTION fixture_assert(boolean, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %', $2; END IF; RAISE NOTICE 'PASS %', $2; END $$;
-- An insert shaped like the FOH walk-in fallback: a status, and no payment status.
CREATE FUNCTION fixture_foh_insert(p_ref text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  INSERT INTO public.table_bookings (booking_reference, status, party_size, source)
  VALUES (p_ref, 'confirmed', 20, 'management') RETURNING coalesce(payment_status::text, 'null') INTO v;
  RETURN v;
END $$;
"""


def main():
    with tempfile.TemporaryDirectory(prefix='tbpay-pg-') as folder:
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

        def check(expression, label): sql("SELECT fixture_assert(" + expression + ",'" + label.replace("'", "''") + "');")

        def default_of(column):
            return (f"(SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' "
                    f"AND table_name = 'table_bookings' AND column_name = '{column}')")

        def state():
            return sql("SELECT string_agg(booking_reference || '=' || coalesce(payment_status::text, 'null'), ',' ORDER BY booking_reference) "
                       "FROM public.table_bookings WHERE booking_reference NOT LIKE 'FOH%';")

        def pending(ref):
            return f"(SELECT payment_status::text FROM public.table_bookings WHERE booking_reference = '{ref}') = 'pending'"

        def cleared(ref):
            return f"(SELECT payment_status FROM public.table_bookings WHERE booking_reference = '{ref}') IS NULL"

        try:
            sql(SETUP)
            check("fixture_foh_insert('FOH-BEFORE') = 'pending'", 'baseline defect: a FOH-shaped insert is saved as deposit pending')
            sql("DELETE FROM public.table_bookings WHERE booking_reference = 'FOH-BEFORE';")
            before = state()

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            check(f"{default_of('payment_status')} IS NOT NULL AND {default_of('status')} IS NOT NULL", 'a rolled-back run keeps both defaults')
            if state() != before: raise RuntimeError('FAIL a rolled-back run changed the rows')
            print('PASS a rolled-back run changes no row')

            sql(MIGRATION.read_text())
            check(f"{default_of('payment_status')} IS NULL", 'payment_status has no default')
            check(f"{default_of('status')} IS NULL", 'status has no default')
            check("fixture_foh_insert('FOH-AFTER') = 'null'", 'a FOH-shaped insert is saved with no payment status')
            error = subprocess.run(cmd, input="INSERT INTO public.table_bookings (booking_reference) VALUES ('FOH-NO-STATUS');",
                                   text=True, capture_output=True).stderr
            if 'null value in column "status"' not in error:
                raise RuntimeError(f'FAIL an insert without a status was not refused: {error!r}')
            print('PASS an insert that forgets the status fails instead of looking unpaid')

            for ref, label in [('TB-W0000001', 'a moneyless walk-in'), ('TB-W0000002', 'the moneyless 20-person override'),
                               ('TB-W0000003', 'a completed moneyless walk-in')]:
                check(cleared(ref), f'the backfill clears {label}')
            for ref, label in [('TB-W0000004', 'a walk-in with a PayPal capture'), ('TB-W0000005', 'a walk-in with a locked deposit'),
                               ('TB-W0000006', 'a walk-in with a payments row'), ('TB-ABCDEF01', 'an ordinary booking awaiting its deposit')]:
                check(pending(ref), f'the backfill leaves {label} alone')

            after = state()
            sql(MIGRATION.read_text())
            if state() != after: raise RuntimeError('FAIL a second run changed the rows')
            print('PASS a second run is a no-op')

            sql(ROLLBACK.read_text())
            check(f"{default_of('payment_status')} = '''pending''::payment_status'", 'the rollback restores the payment_status default')
            check(f"{default_of('status')} = '''pending_payment''::table_booking_status'", 'the rollback restores the status default')
            check(pending('TB-W0000001') + ' AND ' + pending('TB-W0000002'), "the rollback puts 'pending' back on the rows it lists")
            check(cleared('TB-W0000003'), 'and leaves a row it does not list alone')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
