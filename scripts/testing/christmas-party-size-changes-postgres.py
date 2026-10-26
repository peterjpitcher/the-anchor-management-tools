#!/usr/bin/env python3
"""Run the Christmas party size migration in an isolated socket-only PostgreSQL database.

assert_christmas_course_snapshot_v01 is loaded as production holds it (the rollback file), with the
seat touch trigger as production has it; the tables and the course policy are fixtures, and the
policy is switched between "before the deadline" and "after it". Against the old definition it shows
the two defects: in the final week a party of 8 with 2 and 3 course guests cannot lose a guest or
gain one on 1 course, and when a guest leaves, the dishes of a guest who stays are cleared because
seats were matched by position. Then the migration runs and proves the fix (8 to 7 with mixed tiers
and 7 to 8 with a 1 course guest, both after the deadline, with the right guest leaving and nobody
else's dishes touched), the refusals that remain, the function's own unhappy paths, that a refused
change rolls the seat removal back, that a rolled-back run changes nothing, that both functions keep
SECURITY INVOKER, their search_path and service-role-only grants, and that the rollback restores
production exactly.

Run with: LC_ALL=C python3 scripts/testing/christmas-party-size-changes-postgres.py
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261026190515_christmas_party_size_changes.sql'
ROLLBACK = ROOT / 'tasks/christmas-party-size-changes/rollback.sql'
TRIGGER_FN = 'assert_christmas_course_snapshot_v01()'
CHANGE_FN = 'change_christmas_party_v01(uuid,integer[],integer[])'
DEADLINE = "'Christmas pre-order deadline has passed for that date.'"

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.table_bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), party_size integer,
 committed_party_size integer, christmas_course_counts integer[], booking_type text DEFAULT 'christmas',
 booking_period_answer boolean DEFAULT true, booking_period_requires_preorder boolean,
 booking_date date DEFAULT '2026-12-05', updated_at timestamptz DEFAULT now());
CREATE TABLE public.booking_preorder_covers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 table_booking_id uuid NOT NULL REFERENCES public.table_bookings(id) ON DELETE CASCADE,
 ordinal integer NOT NULL CHECK (ordinal >= 1), guest_name text, dietary_note text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (table_booking_id, ordinal));
CREATE TABLE public.booking_preorder_selections(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 cover_id uuid NOT NULL REFERENCES public.booking_preorder_covers(id) ON DELETE CASCADE,
 course text NOT NULL, menu_item_id uuid NOT NULL DEFAULT gen_random_uuid(), item_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
-- As production holds it.
CREATE FUNCTION public.touch_booking_period_updated_at() RETURNS trigger LANGUAGE plpgsql
 SET search_path TO 'public' AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
CREATE TRIGGER booking_preorder_covers_touch_updated_at BEFORE UPDATE ON public.booking_preorder_covers
 FOR EACH ROW EXECUTE FUNCTION public.touch_booking_period_updated_at();
-- Fixture policy: "before the deadline" while fixture_policy.open is true.
CREATE TABLE fixture_policy(open boolean); INSERT INTO fixture_policy VALUES (true);
CREATE FUNCTION public.christmas_course_policy_v01(p_booking_date date) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('multiple_courses_available', (SELECT open FROM fixture_policy)) $$;
CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
-- A booking with one seat per guest named G1, G2, ... whose dishes fit its tier: 3 courses have a
-- starter, a main and a dessert, 2 courses a starter and a main, 1 course nothing. Rows are dated
-- 1 January so a later touch shows.
CREATE FUNCTION fixture_booking(p_counts integer[]) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_cover uuid; i integer;
BEGIN
 INSERT INTO public.table_bookings(party_size, committed_party_size, christmas_course_counts)
  VALUES (cardinality(p_counts), cardinality(p_counts), p_counts) RETURNING id INTO v_id;
 FOR i IN 1..cardinality(p_counts) LOOP
  INSERT INTO public.booking_preorder_covers(table_booking_id, ordinal, guest_name, created_at, updated_at)
   VALUES (v_id, i, 'G' || i, '2026-01-01', '2026-01-01') RETURNING id INTO v_cover;
  IF p_counts[i] >= 2 THEN
   INSERT INTO public.booking_preorder_selections(cover_id, course, item_name) VALUES
    (v_cover, 'main', 'Turkey ' || i), (v_cover, 'starter', 'Soup ' || i);
  END IF;
  IF p_counts[i] = 3 THEN
   INSERT INTO public.booking_preorder_selections(cover_id, course, item_name) VALUES (v_cover, 'dessert', 'Pudding ' || i);
  END IF;
 END LOOP;
 RETURN v_id;
END $$;
-- "G1:2,G3:3,..." : each seat in order, with how many dishes it holds.
CREATE FUNCTION fixture_seats(p_id uuid) RETURNS text LANGUAGE sql AS $$
 SELECT string_agg(c.guest_name || ':' || (SELECT count(*) FROM public.booking_preorder_selections s WHERE s.cover_id = c.id), ',' ORDER BY c.ordinal)
   FROM public.booking_preorder_covers c WHERE c.table_booking_id = p_id $$;
-- Runs a statement and returns 'ok' or the error message.
CREATE FUNCTION fixture_try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
"""


def main():
    with tempfile.TemporaryDirectory(prefix='xmas-party-pg-') as folder:
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
        def deadline(open_): sql(f"UPDATE fixture_policy SET open = {'true' if open_ else 'false'};")
        def booking(counts): return sql(f"SELECT fixture_booking(ARRAY{counts});")
        def q(value): return "'" + value.replace("'", "''") + "'"
        def attempt(statement): return f"fixture_try({q(statement)})"
        def change(booking_id, counts, removed='{}'):
            return attempt(f"SELECT public.change_christmas_party_v01('{booking_id}', ARRAY{counts}::integer[], '{removed}'::integer[])")
        def resize(booking_id, counts):
            return attempt(f"UPDATE public.table_bookings SET party_size = {len(counts)}, christmas_course_counts = ARRAY{counts} WHERE id = '{booking_id}'")
        def state():
            return sql(
                f"SELECT md5(pg_get_functiondef('{TRIGGER_FN}'::regprocedure)) || coalesce((SELECT proacl::text FROM pg_proc WHERE oid = '{TRIGGER_FN}'::regprocedure), '')"
                f" || coalesce(to_regprocedure('{CHANGE_FN}')::text, 'no change function')"
                " || (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'booking_preorder_covers_touch_updated_at');")

        try:
            sql(SETUP)
            sql(ROLLBACK.read_text())
            sql("CREATE TRIGGER table_bookings_christmas_course_snapshot BEFORE INSERT OR UPDATE ON public.table_bookings "
                "FOR EACH ROW EXECUTE FUNCTION public.assert_christmas_course_snapshot_v01();")
            before = state()
            check(f"md5((SELECT prosrc FROM pg_proc WHERE oid = '{TRIGGER_FN}'::regprocedure)) = '9a9b32e9948155f0a945ec020984f536'",
                  "the rollback file holds production's trigger function exactly")

            # The defects, against production's definition.
            deadline(False)
            old = booking([3, 2, 2, 3, 1, 1, 1, 1])
            check(f"{resize(old, [3, 2, 2, 3, 1, 1, 1])} = {DEADLINE}",
                  'baseline: in the final week a party of 8 with 2 and 3 course guests cannot lose a guest')
            check(f"{resize(old, [3, 2, 2, 3, 1, 1, 1, 1, 1])} = {DEADLINE}",
                  'baseline: in the final week it cannot gain a guest on 1 course')
            deadline(True)
            shifted = booking([3, 2, 3, 1])
            # Guest 2 leaves: the guests after them close up a seat and the list drops their tier.
            sql(f"DELETE FROM booking_preorder_covers WHERE table_booking_id = '{shifted}' AND ordinal = 2;"
                f"UPDATE booking_preorder_covers SET ordinal = ordinal - 1 WHERE table_booking_id = '{shifted}' AND ordinal > 2;")
            check(f"{resize(shifted, [3, 3, 1])} = 'ok' AND fixture_seats('{shifted}') = 'G1:3,G3:0,G4:0'",
                  "baseline: when guest 2 leaves, guest 3's three dishes are cleared because seats were matched by position")

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if state() != before: raise RuntimeError('FAIL a rolled-back run changed a definition')
            print('PASS a rolled-back run leaves every definition as it was')

            sql(MIGRATION.read_text())

            # The final week (D21): a guest leaves, and a guest joins on 1 course.
            deadline(False)
            party = booking([3, 2, 2, 3, 1, 1, 1, 1])
            check(f"{change(party, [3, 2, 3, 1, 1, 1, 1], '{2}')} = 'ok'", 'after the deadline, 8 to 7 with mixed tiers saves')
            check(f"(SELECT party_size = 7 AND committed_party_size = 7 AND christmas_course_counts = ARRAY[3,2,3,1,1,1,1] FROM table_bookings WHERE id = '{party}')",
                  'the party size and course list are the new ones')
            check(f"fixture_seats('{party}') = 'G1:3,G3:2,G4:3,G5:0,G6:0,G7:0,G8:0'",
                  'guest 2 is the one who left, and everyone else keeps their own dishes in order')
            check(f"(SELECT bool_and(updated_at = '2026-01-01') FROM booking_preorder_covers WHERE table_booking_id = '{party}')",
                  'closing up seat numbers does not mark the guests who moved as changed')
            check(f"(SELECT public.change_christmas_party_v01('{party}', ARRAY[3,2,3,1,1,1]::integer[], '{{4}}')->'removed'->0->>'guest_name') = 'G5'",
                  'the function says who left, so staff can tell the booker')
            check(f"{change(party, [3, 2, 3, 1, 1, 1, 1])} = 'ok'", 'after the deadline, a guest joins on 1 course (6 to 7)')
            check(f"(SELECT party_size FROM table_bookings WHERE id = '{party}') = 7", 'and the party is 7 again')
            eight = booking([3, 2, 2, 3, 1, 1, 1])
            check(f"{change(eight, [3, 2, 2, 3, 1, 1, 1, 1])} = 'ok' AND fixture_seats('{eight}') = 'G1:3,G2:2,G3:2,G4:3,G5:0,G6:0,G7:0'",
                  'after the deadline, 7 to 8 with a new 1 course guest saves and no dishes move')
            check(f"{change(eight, [2, 2, 2, 3, 1, 1, 1, 1])} = 'ok' AND fixture_seats('{eight}') = 'G1:0,G2:2,G3:2,G4:3,G5:0,G6:0,G7:0'",
                  'after the deadline, a guest moving down from 3 to 2 courses saves, and their 3 dishes are cleared')

            # What is still refused after the deadline.
            check(f"{change(eight, [2, 2, 2, 3, 1, 1, 1, 1, 2])} = {DEADLINE}", 'after the deadline, a new guest on 2 courses is refused')
            check(f"{change(eight, [2, 2, 2, 3, 2, 1, 1, 1])} = {DEADLINE}", 'after the deadline, a guest moving up from 1 to 2 courses is refused')
            check(f"{change(eight, [2, 2, 2, 3, 3, 1, 1, 1])} = {DEADLINE}", 'after the deadline, a guest moving up to 3 courses is refused')
            check(f"{change(eight, [2, 2, 2, 3, 1, 1, 1, 2], '{5}')} = {DEADLINE} AND fixture_seats('{eight}') = 'G1:0,G2:2,G3:2,G4:3,G5:0,G6:0,G7:0'",
                  'after the deadline, a guest leaving cannot make room for a new guest on 2 courses, and nobody is removed')
            check(f"{change(eight, [2, 2, 3, 1, 1, 1, 1, 2], '{1}')} = {DEADLINE}",
                  'after the deadline, swapping a leaving 2 course guest for a new 2 course guest is refused guest by guest')
            check(f"{change(eight, [1, 2, 2, 3, 2, 1, 1, 1])} = {DEADLINE}",
                  'after the deadline, one guest moving down cannot pay for another moving up')
            check(f"{resize(eight, [1, 2, 2, 3, 2, 1, 1, 1])} = 'ok'",
                  'the trigger alone judges the party as a whole, so that swap is the function and the application to refuse')
            deadline(True)
            check(f"{resize(eight, [2, 2, 2, 3, 1, 1, 1, 1])} = 'ok'", 'before the deadline the same party can be set back again')
            deadline(False)
            check(f"{attempt(f'UPDATE table_bookings SET booking_date = date {chr(39)}2026-12-12{chr(39)} WHERE id = {chr(39)}{eight}{chr(39)}')} = {DEADLINE}",
                  'moving a booking with 2 or 3 course guests to a date past its deadline is still refused')
            legacy = sql("INSERT INTO table_bookings(party_size, committed_party_size) VALUES (4, 4) RETURNING id;")
            check(f"{change(legacy, [2, 1, 1, 1])} = {DEADLINE}", 'recording 2 or 3 courses for the first time after the deadline is still refused')
            check(f"{change(legacy, [1, 1, 1, 1])} = 'ok'", 'recording 1 course for everyone after the deadline is still allowed')

            # Before the deadline, tiers change freely and dishes follow the seat.
            deadline(True)
            early = booking([2, 3, 1, 1])
            check(f"{change(early, [3, 3, 1, 1])} = 'ok' AND fixture_seats('{early}') = 'G1:2,G2:3,G3:0,G4:0'",
                  'before the deadline, 2 to 3 courses keeps the dishes already chosen')
            check(f"{change(early, [3, 1, 1, 1])} = 'ok' AND fixture_seats('{early}') = 'G1:2,G2:0,G3:0,G4:0'",
                  'before the deadline, 3 to 1 course clears that seat and no other')
            shrink = booking([3, 3, 2, 1])
            check(f"{resize(shrink, [3, 3, 2])} = 'ok' AND fixture_seats('{shrink}') = 'G1:3,G2:3,G3:2,G4:0'",
                  'a seat above the new party size keeps its dishes for preorder_sync_covers to report')
            undo = booking([3, 2, 1, 1])
            check(f"{change(undo, [3, 1, 4], '{2}')} = 'Christmas bookings need a course choice for every guest when changing the party size.' "
                  f"AND fixture_seats('{undo}') = 'G1:3,G2:2,G3:0,G4:0'",
                  'a change the trigger refuses rolls back the guest the function had removed')

            # The function's own unhappy paths change nothing.
            guard = booking([3, 2, 1, 1])
            for removed, label in (('{5}', 'a seat number above the party'), ('{0}', 'seat 0'), ('{2,2}', 'the same guest twice')):
                check(f"{change(guard, [3, 1, 1], removed)} = 'Choose the guests who are leaving from the guests on this booking.'",
                      f'removing {label} is refused')
            check(f"{change(guard, [3], '{2}')} = 'Choose the guests who are leaving from the guests on this booking.'",
                  'a course list shorter than the guests who stay is refused')
            plain = sql("INSERT INTO table_bookings(party_size, committed_party_size) VALUES (4, 4) RETURNING id;")
            check(f"{change(plain, [1, 1, 1], '{1}')} = 'Choose the guests who are leaving from the guests on this booking.'",
                  'removing a guest from a booking with no course list is refused')
            check(f"{attempt(f'SELECT public.change_christmas_party_v01({chr(39)}{guard}{chr(39)}, NULL)')} = 'Christmas bookings need a course choice for every guest when changing the party size.'",
                  'a missing course list is refused')
            check(f"{change('00000000-0000-0000-0000-000000000000', [1, 1, 1, 1])} = 'Booking was not found.'", 'an unknown booking is refused')
            check(f"fixture_seats('{guard}') = 'G1:3,G2:2,G3:0,G4:0' AND (SELECT party_size FROM table_bookings WHERE id = '{guard}') = 4",
                  'none of those refusals changed the booking or its seats')
            check(f"{attempt(f'UPDATE table_bookings SET christmas_course_counts = NULL WHERE id = {chr(39)}{guard}{chr(39)}')} = 'Christmas course choices cannot be cleared.'",
                  'course choices still cannot be cleared')
            check(f"{attempt(f'UPDATE table_bookings SET booking_type = {chr(39)}regular{chr(39)} WHERE id = {chr(39)}{guard}{chr(39)}')} = 'Christmas course choices must remain attached to a Christmas booking.'",
                  'course choices still stay with a Christmas booking')
            sql(f"UPDATE booking_preorder_covers SET guest_name = 'Sam' WHERE table_booking_id = '{guard}' AND ordinal = 1;")
            check(f"(SELECT updated_at > '2026-01-01' FROM booking_preorder_covers WHERE table_booking_id = '{guard}' AND ordinal = 1)",
                  "changing a seat's name still marks the seat as changed")

            for signature in (TRIGGER_FN, CHANGE_FN):
                check(f"NOT has_function_privilege('anon','{signature}','EXECUTE') AND NOT has_function_privilege('authenticated','{signature}','EXECUTE') "
                      f"AND has_function_privilege('service_role','{signature}','EXECUTE') AND NOT has_function_privilege('public','{signature}','EXECUTE')",
                      f'only the service role can run {signature.split("(")[0]}')
                check(f"(SELECT NOT prosecdef AND proconfig = ARRAY['search_path=public, pg_catalog'] FROM pg_proc WHERE oid = '{signature}'::regprocedure)",
                      f'{signature.split("(")[0]} keeps SECURITY INVOKER and its search_path')

            sql(ROLLBACK.read_text())
            if state() != before: raise RuntimeError('FAIL rollback did not restore the old definitions')
            print('PASS rollback restores production exactly: the trigger function, no change function, and the touch trigger')
            deadline(False)
            back = booking([3, 2, 2, 3, 1, 1, 1, 1])
            check(f"{resize(back, [3, 2, 2, 3, 1, 1, 1])} = {DEADLINE}", 'rollback brings back the old behaviour')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__': main()
