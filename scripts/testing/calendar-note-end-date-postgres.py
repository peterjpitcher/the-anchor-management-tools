#!/usr/bin/env python3
"""Exercise the calendar note end date backfill in an isolated socket-only PostgreSQL database.

The real calendar note, end date and Google sync queue migrations build the table and its
triggers. Only what those migrations lean on is a fixture: the auth schema, the permission
check and the updated_at trigger function. The rows are synthetic.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATIONS = ROOT / 'supabase/migrations'
HISTORY = [
    MIGRATIONS / '20260421000000_add_calendar_notes.sql',
    MIGRATIONS / '20260421000001_add_calendar_notes_end_date.sql',
    MIGRATIONS / '20260730000000_calendar_note_google_sync_queue.sql',
]
MIGRATION = MIGRATIONS / '20261005110211_calendar_notes_end_date_required.sql'
ROLLBACK = ROOT / 'tasks/calendar-notes-end-date/rollback.sql'

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid primary key);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.user_has_permission(uuid, text, text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE FUNCTION fixture_assert(boolean, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %', $2; END IF; RAISE NOTICE 'PASS %', $2; END $$;
"""

# Two notes saved the way the July insert saved them (no end date), two saved the way the app
# saves them. The queue is then marked synced, which is the state production is in. The two
# notes with no end date carry ids from the rollback file's list, so the rollback has rows to act on.
FIXTURES = r"""
INSERT INTO public.calendar_notes(id, note_date, end_date, title) VALUES
 ('16f9bac0-ba5d-47b6-9efd-95949be432e9', '2026-10-25', NULL, 'Clocks go back'),
 ('1a69aba1-c165-42dc-922f-d3960ddcdcfe', '2026-12-25', NULL, 'Christmas Day'),
 ('00000000-0000-0000-0000-000000000003', '2026-10-17', '2026-11-01', 'Autumn Half Term'),
 ('00000000-0000-0000-0000-000000000004', '2026-11-05', '2026-11-05', 'Bonfire Night');
UPDATE public.calendar_note_google_sync_queue SET status = 'synced';
"""

NULLABLE = "(SELECT NOT attnotnull FROM pg_attribute WHERE attrelid='public.calendar_notes'::regclass AND attname='end_date')"
TRIGGER_ON = "(SELECT tgenabled='O' FROM pg_trigger WHERE tgrelid='public.calendar_notes'::regclass AND tgname='queue_calendar_note_google_sync')"
NO_END_DATE = "(SELECT count(*) FROM public.calendar_notes WHERE end_date IS NULL)"
QUEUE_QUIET = "(SELECT count(*) FILTER (WHERE status='synced' AND generation=1)=4 AND count(*)=4 FROM public.calendar_note_google_sync_queue)"

def main():
    with tempfile.TemporaryDirectory(prefix='note-end-date-pg-') as folder:
        work = Path(folder); socket = work / 'socket'; socket.mkdir(); cluster = work / 'db'
        subprocess.run([str(PG / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'log'), '-o', f"-k {socket} -c listen_addresses=''", '-w', 'start'], check=True, capture_output=True)
        cmd = [str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1']
        def sql(value):
            result = subprocess.run(cmd, input=value, text=True, capture_output=True)
            if result.returncode: raise RuntimeError(result.stderr)
            for line in result.stderr.splitlines():
                if 'PASS ' in line: print(line)
            return result.stdout
        def check(expression, label): sql("SELECT fixture_assert(" + expression + ",'" + label + "');")
        def fails_with(statement, sqlstate, label):
            sql("DO $t$ BEGIN " + statement + "; RAISE EXCEPTION 'FAIL " + label + " (statement was accepted)';"
                " EXCEPTION WHEN SQLSTATE '" + sqlstate + "' THEN RAISE NOTICE 'PASS " + label + "'; END $t$;")
        try:
            sql(SETUP)
            for migration in HISTORY: sql(migration.read_text())
            sql(FIXTURES)
            check(NO_END_DATE + "=2", 'baseline has notes with no end date')
            check(NULLABLE, 'baseline column is optional')
            check(QUEUE_QUIET, 'baseline queue is fully synced')

            sql('BEGIN;' + MIGRATION.read_text() + 'ROLLBACK;')
            check(NO_END_DATE + "=2", 'rolled back transaction leaves the rows alone')
            check(NULLABLE, 'rolled back transaction leaves the column optional')
            check(TRIGGER_ON, 'rolled back transaction leaves the sync trigger on')

            sql(MIGRATION.read_text())
            check(NO_END_DATE + "=0", 'no note is left without an end date')
            check("(SELECT bool_and(end_date=note_date) FROM public.calendar_notes WHERE title IN ('Clocks go back','Christmas Day'))", 'notes with no end date become one-day notes')
            check("(SELECT end_date='2026-11-01' FROM public.calendar_notes WHERE title='Autumn Half Term')", 'a multi-day note keeps its end date')
            check("(SELECT end_date='2026-11-05' FROM public.calendar_notes WHERE title='Bonfire Night')", 'a one-day note with an end date is untouched')
            check("NOT " + NULLABLE, 'end date is now required')
            check(QUEUE_QUIET, 'the backfill queued no Google Calendar re-sync')
            check(TRIGGER_ON, 'the sync trigger is back on')
            check("(SELECT count(*)=1 FROM pg_constraint WHERE conrelid='public.calendar_notes'::regclass AND conname='calendar_notes_date_range_check')", 'the date range check is still in place')

            sql(MIGRATION.read_text())
            check(QUEUE_QUIET, 'a second run changes nothing')

            fails_with("INSERT INTO public.calendar_notes(note_date, title) VALUES ('2026-12-31', 'No end date')", '23502', 'a note saved without an end date is refused')
            fails_with("INSERT INTO public.calendar_notes(note_date, end_date, title) VALUES ('2026-12-31', '2026-12-30', 'Backwards')", '23514', 'an end date before the start is still refused')

            sql("UPDATE public.calendar_notes SET title='Clocks go back (2am)' WHERE title='Clocks go back';")
            check("(SELECT status='pending' AND generation=2 FROM public.calendar_note_google_sync_queue WHERE note_id='16f9bac0-ba5d-47b6-9efd-95949be432e9')", 'a real edit afterwards is queued for Google Calendar')
            sql("INSERT INTO public.calendar_notes(id, note_date, end_date, title) VALUES ('00000000-0000-0000-0000-000000000005', '2027-01-01', '2027-01-01', 'New Year');")
            check("(SELECT status='pending' FROM public.calendar_note_google_sync_queue WHERE note_id='00000000-0000-0000-0000-000000000005')", 'a new note afterwards is queued for Google Calendar')

            sql("UPDATE public.calendar_notes SET end_date='2026-12-26' WHERE title='Christmas Day';")
            sql(ROLLBACK.read_text())
            check(NULLABLE, 'rollback makes the end date optional again')
            check("(SELECT end_date IS NULL FROM public.calendar_notes WHERE id='16f9bac0-ba5d-47b6-9efd-95949be432e9')", 'rollback clears the end date the backfill gave')
            check("(SELECT end_date='2026-12-26' FROM public.calendar_notes WHERE title='Christmas Day')", 'rollback leaves a note whose end date was changed since')
            check("(SELECT end_date='2026-11-05' FROM public.calendar_notes WHERE title='Bonfire Night')", 'rollback leaves a note that was never backfilled')
            check("(SELECT generation=2 FROM public.calendar_note_google_sync_queue WHERE note_id='16f9bac0-ba5d-47b6-9efd-95949be432e9')", 'rollback queues no Google Calendar re-sync')
            check(TRIGGER_ON, 'rollback leaves the sync trigger on')

            sql(MIGRATION.read_text())
            check(NO_END_DATE + "=0 AND NOT " + NULLABLE, 'the migration applies cleanly again after a rollback')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)

if __name__ == '__main__': main()
