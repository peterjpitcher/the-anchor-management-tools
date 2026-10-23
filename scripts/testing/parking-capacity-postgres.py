#!/usr/bin/env python3
"""Run the parking last-space capacity migration in an isolated socket-only PostgreSQL database.

check_parking_capacity and the old enforce_parking_capacity are loaded from the migrations that
last defined them, with the search_path production holds. Against the old trigger it shows the
defect: with every space taken one more booking still goes in, and two bookings made at once for
the last space both go in, whether their days match or only overlap. Then the migration runs and
the same races end with one booking refused, while payments, cancellations, shorter stays, notes
and late payments still go through on a car park that staff overrides have filled past its limit. It also
checks that a rolled-back run changes nothing, that the function keeps its settings and grants,
and that the rollback restores the old definition exactly.

Then the forward fix runs: before it, a cancelled booking could be confirmed onto full dates
through the late-payment exception; after it, only a lapsed booking skips the check, and the rest
of the run (moves, payments, races) passes on the fixed function.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATIONS = ROOT / 'supabase/migrations'
MIGRATION = MIGRATIONS / '20261023162908_parking_last_space_capacity.sql'
# Limits the late-payment exception to a lapsed booking (Codex review of PR 241).
FIX = MIGRATIONS / '20261023171329_parking_late_payment_bypass_expired_only.sql'
CHECK_SOURCE = MIGRATIONS / '20260811120000_parking_capacity_half_open.sql'
OLD_SOURCE = MIGRATIONS / '20260517000000_fix_parking_toctou.sql'

REFUSAL = 'No parking spaces remaining for the selected period'

SETUP = """
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE public.parking_booking_status AS ENUM ('pending_payment', 'confirmed', 'completed', 'cancelled', 'expired');
CREATE TABLE public.parking_rates (
  id serial PRIMARY KEY,
  effective_from timestamptz NOT NULL DEFAULT now() - interval '1 day',
  capacity_override integer
);
-- Capacity 3 keeps the races short. Production resolves 10 the same way.
INSERT INTO public.parking_rates (capacity_override) VALUES (3);
CREATE TABLE public.parking_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  status public.parking_booking_status NOT NULL DEFAULT 'pending_payment',
  payment_status text NOT NULL DEFAULT 'pending',
  capacity_override boolean DEFAULT false,
  notes text
);
"""

# Production's trigger, as pg_get_triggerdef reports it.
TRIGGER = """
CREATE TRIGGER trg_enforce_parking_capacity BEFORE INSERT OR UPDATE ON public.parking_bookings
FOR EACH ROW EXECUTE FUNCTION public.enforce_parking_capacity();
"""

# Production's grants on the trigger function (proacl on 19 October 2026).
GRANTS = 'GRANT EXECUTE ON FUNCTION public.enforce_parking_capacity() TO anon, authenticated, service_role;'

DAY = '2026-11-03'
FULL = (f'{DAY}T08:00:00Z', f'{DAY}T18:00:00Z')
INSIDE = (f'{DAY}T09:00:00Z', f'{DAY}T17:00:00Z')
# Overlaps INSIDE on different days, so the old date-pair lock gave it a different key.
SPANNING = ('2026-11-02T12:00:00Z', '2026-11-04T12:00:00Z')
AFTER = (f'{DAY}T18:00:00Z', f'{DAY}T20:00:00Z')
SHORTER = (f'{DAY}T09:00:00Z', f'{DAY}T12:00:00Z')
FREE = ('2026-11-10T09:00:00Z', '2026-11-10T17:00:00Z')


def old_definition():
    """The trigger function as production holds it: the 17 May body with the May search_path."""
    text = OLD_SOURCE.read_text()
    start = text.index('CREATE OR REPLACE FUNCTION public.enforce_parking_capacity()')
    end = text.index('$$ LANGUAGE plpgsql;', start) + len('$$ LANGUAGE plpgsql;')
    return text[start:end] + '\nALTER FUNCTION public.enforce_parking_capacity() SET search_path = public, pg_catalog;'


def main():
    with tempfile.TemporaryDirectory(prefix='parking-capacity-') as tmp:
        work = Path(tmp)
        cluster, socket = work / 'data', work / 'socket'
        socket.mkdir()
        subprocess.run([str(PG / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([
            str(PG / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'log'),
            '-o', f"-c listen_addresses='' -c unix_socket_directories='{socket}'", '-w', 'start',
        ], check=True, capture_output=True)
        command = [str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']

        def sql(text):
            done = subprocess.run(command, input=text, text=True, capture_output=True)
            if done.returncode:
                raise RuntimeError(done.stderr)
            return done.stdout.strip()

        def refused(text):
            """Run text expecting the capacity refusal; anything else fails the harness."""
            done = subprocess.run(command, input=text, text=True, capture_output=True)
            if done.returncode == 0:
                return False
            if REFUSAL not in done.stderr:
                raise RuntimeError(done.stderr)
            return True

        def check(condition, label):
            if not condition:
                raise RuntimeError('FAIL ' + label)
            print('PASS ' + label)

        def holds(expression, label):
            check(sql(f'SELECT ({expression})::text;') == 'true', label)

        def insert(window, note, status='pending_payment', override=False):
            return (f"INSERT INTO public.parking_bookings (start_at, end_at, status, capacity_override, notes) "
                    f"VALUES ('{window[0]}', '{window[1]}', '{status}', {str(override).lower()}, '{note}');")

        def update(note, assignments):
            return f"UPDATE public.parking_bookings SET {assignments} WHERE notes = '{note}';"

        def active(window):
            return (f"(SELECT count(*) FROM public.parking_bookings WHERE status IN ('pending_payment', 'confirmed') "
                    f"AND tstzrange(start_at, end_at, '[)') && tstzrange('{window[0]}', '{window[1]}', '[)'))")

        def fill(count):
            sql('TRUNCATE public.parking_bookings;')
            for n in range(count):
                sql(insert(FULL, f'existing-{n}'))

        def wait_for(expression, label, seconds=20):
            deadline = time.time() + seconds
            while time.time() < deadline:
                if sql(f'SELECT ({expression})::text;') == 'true':
                    return
                time.sleep(0.05)
            raise RuntimeError('TIMEOUT ' + label)

        def session(name):
            return subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    text=True, env=dict(os.environ, PGAPPNAME=name))

        def send(process, text):
            process.stdin.write(text + '\n')
            process.stdin.flush()

        def race(b_window, b_waits):
            """A takes the last space and holds its transaction open while B books b_window.

            Returns B's outcome: 'refused' or 'booked'. b_waits says whether B must queue behind
            A's lock (checked in pg_stat_activity) or, under the old key, run straight past it.
            """
            fill(2)
            a = session('race_a')
            send(a, 'BEGIN;')
            send(a, insert(INSIDE, 'race-a'))
            wait_for("EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'race_a' "
                     "AND state = 'idle in transaction')", 'A holds the last space uncommitted')
            b = session('race_b')
            send(b, 'BEGIN;')
            send(b, insert(b_window, 'race-b'))
            send(b, 'COMMIT;')
            if b_waits:
                wait_for("EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'race_b' "
                         "AND wait_event_type = 'Lock' AND wait_event = 'advisory')", 'B queues behind A')
            else:
                wait_for("EXISTS (SELECT 1 FROM public.parking_bookings WHERE notes = 'race-b')",
                         'B commits while A is still open')
            send(a, 'COMMIT;')
            a_out, a_err = a.communicate(timeout=30)
            b_out, b_err = b.communicate(timeout=30)
            if a.returncode:
                raise RuntimeError('A failed: ' + a_err)
            if b.returncode == 0:
                return 'booked'
            if REFUSAL not in b_err:
                raise RuntimeError('B failed for another reason: ' + b_err)
            return 'refused'

        def definition():
            return sql("SELECT prosrc FROM pg_proc WHERE proname = 'enforce_parking_capacity';")

        def settings():
            return sql("SELECT coalesce(proconfig::text, '') || ' ' || prosecdef::text || ' ' || coalesce(proacl::text, '') "
                       "FROM pg_proc WHERE proname = 'enforce_parking_capacity';")

        try:
            sql(SETUP)
            sql(CHECK_SOURCE.read_text())
            sql(old_definition())
            sql(GRANTS)
            sql(TRIGGER)
            original_body, original_settings = definition(), settings()
            trigger_def = sql("SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_enforce_parking_capacity';")
            check('search_path=public, pg_catalog' in original_settings, 'the old definition loads with production settings')

            # The defect, on the old trigger.
            fill(3)
            sql(insert(INSIDE, 'one-too-many'))
            holds(f'{active(INSIDE)} = 4', 'old: with every space taken, one more booking still goes in')
            check(race(INSIDE, b_waits=True) == 'booked', 'old: two bookings for the same days both take the last space')
            holds(f'{active(INSIDE)} = 4', 'old: the car park is one over after the same-days race')
            check(race(SPANNING, b_waits=False) == 'booked',
                  'old: an overlapping booking on other days skips the lock and takes the last space too')
            holds(f'{active(INSIDE)} = 4', 'old: the car park is one over after the overlapping race')

            sql('BEGIN;' + MIGRATION.read_text() + 'ROLLBACK;')
            check(definition() == original_body and settings() == original_settings, 'a rolled-back run changes nothing')

            sql(MIGRATION.read_text())
            applied_body = definition()
            check(definition() != original_body, 'the migration replaces the function')
            check(settings() == original_settings, 'search_path, SECURITY INVOKER and grants are unchanged')
            holds("(SELECT count(*) FROM pg_proc WHERE proname = 'enforce_parking_capacity') = 1", 'still one function')
            check(sql("SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_enforce_parking_capacity';")
                  == trigger_def, 'the trigger is untouched')
            sql(MIGRATION.read_text())
            check(settings() == original_settings, 'running it twice is harmless')

            # One at a time.
            fill(3)
            check(refused(insert(INSIDE, 'one-too-many')), 'new: no booking once every space is taken')
            holds(f'{active(INSIDE)} = 3', 'new: the car park stays at capacity')
            sql(insert(AFTER, 'back-to-back'))
            holds("EXISTS (SELECT 1 FROM public.parking_bookings WHERE notes = 'back-to-back')",
                  'new: a booking starting as the others end still goes in')
            sql(insert(INSIDE, 'cancelled-row', status='cancelled'))
            holds("EXISTS (SELECT 1 FROM public.parking_bookings WHERE notes = 'cancelled-row')",
                  'new: a row that holds no space is not checked')
            sql(insert(INSIDE, 'staff-override', override=True))
            holds(f'{active(INSIDE)} = 4', 'new: staff can still book past the limit with capacity override')

            # Everyday updates on a car park staff have filled past its limit (4 of 3).
            sql(update('existing-0', "status = 'confirmed', payment_status = 'paid'"))
            holds("(SELECT status::text FROM public.parking_bookings WHERE notes = 'existing-0') = 'confirmed'",
                  'new: a payment is recorded on an over-full car park')
            sql(update('existing-1', "notes = 'existing-1'"))
            print('PASS new: a note or name fix goes through on an over-full car park')
            sql(update('existing-0', f"start_at = '{SHORTER[0]}', end_at = '{SHORTER[1]}'"))
            holds("(SELECT end_at = timestamptz '2026-11-03T12:00:00Z' FROM public.parking_bookings WHERE notes = 'existing-0')",
                  'new: a shorter stay inside the old one goes through on an over-full car park')
            check(refused(update('existing-0', f"start_at = '{FULL[0]}', end_at = '{FULL[1]}'")),
                  'new: lengthening a stay onto full dates is refused')
            sql(update('existing-1', "status = 'cancelled'"))
            sql(update('existing-1', "payment_status = 'refunded'"))
            holds("(SELECT payment_status FROM public.parking_bookings WHERE notes = 'existing-1') = 'refunded'",
                  'new: a cancellation and its refund go through')

            # Claiming a space again (3 of 3 held now).
            check(refused(update('existing-1', "status = 'pending_payment'")),
                  'new: a cancelled booking cannot be reopened onto full dates')

            # The late-payment exception never looked at the old status.
            confirm_cancelled = update('existing-1', "status = 'confirmed', payment_status = 'paid'")
            check(sql('BEGIN;' + confirm_cancelled
                      + "SELECT status::text FROM public.parking_bookings WHERE notes = 'existing-1'; ROLLBACK;")
                  == 'confirmed', 'new: a cancelled booking can still be confirmed onto full dates (the gap)')
            sql(FIX.read_text())
            check(definition() not in (original_body, applied_body), 'fix: the forward fix replaces the function')
            check(settings() == original_settings, 'fix: search_path, SECURITY INVOKER and grants are unchanged')
            check(sql("SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_enforce_parking_capacity';")
                  == trigger_def, 'fix: the trigger is untouched')
            check(refused(confirm_cancelled), 'fix: a cancelled booking cannot be confirmed onto full dates')
            sql(insert(INSIDE, 'finished', status='completed'))
            check(refused(update('finished', "status = 'confirmed'")),
                  'fix: a completed booking cannot be confirmed again onto full dates')

            sql(insert(INSIDE, 'lapsed', status='expired'))
            sql(update('lapsed', "status = 'confirmed', payment_status = 'paid'"))
            holds("(SELECT status::text FROM public.parking_bookings WHERE notes = 'lapsed') = 'confirmed'",
                  'new: a payment landing after the booking lapsed is still recorded')
            sql(update('existing-2', f"start_at = '{FREE[0]}', end_at = '{FREE[1]}'"))
            holds("(SELECT start_at = timestamptz '2026-11-10T09:00:00Z' FROM public.parking_bookings WHERE notes = 'existing-2')",
                  'new: a booking can move to dates with room')
            check(refused(update('existing-2', f"start_at = '{INSIDE[0]}', end_at = '{INSIDE[1]}'")),
                  'new: a booking cannot move onto full dates')
            sql(update('existing-2', f"start_at = '{INSIDE[0]}', end_at = '{INSIDE[1]}', capacity_override = true"))
            print('PASS new: staff can move one onto full dates with capacity override')

            # Two at once.
            check(race(INSIDE, b_waits=True) == 'refused', 'new: of two bookings for the last space, the second is refused')
            holds(f'{active(INSIDE)} = 3', 'new: the car park ends at capacity after the same-days race')
            check(race(SPANNING, b_waits=True) == 'refused',
                  'new: an overlapping booking on other days now queues for the same lock and is refused')
            holds(f'{active(INSIDE)} = 3', 'new: the car park ends at capacity after the overlapping race')
            check(race(FREE, b_waits=True) == 'booked', 'new: a booking with room waits its turn and goes in')

            # Rolling the fix back is re-running the capacity migration.
            sql(MIGRATION.read_text())
            check(definition() == applied_body and settings() == original_settings,
                  'fix rollback: re-running 20261023162908 restores the applied definition')

            # Rollback restores production's definition exactly.
            sql(old_definition())
            check(definition() == original_body and settings() == original_settings,
                  'the rollback restores the old definition and settings')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
