#!/usr/bin/env python3
"""Run the click id clear-down migration in an isolated socket-only PostgreSQL database.

The real migration file runs against synthetic rows shaped like the production ones: the same
metadata keys, and page addresses with a click id in the middle, at the start, alone, in upper
case and before a fragment. It checks what is removed, what is left exactly as it was, that a
second run changes nothing, and that a rolled-back run changes nothing.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261005083112_clear_stored_advert_click_ids.sql'

PAGE = 'https://www.example.com/events/quiz-night'
TAGS = 'utm_source=facebook&utm_medium=paid_social&utm_campaign=quiz&utm_content=a&utm_term=b'

SETUP = rf"""
CREATE TABLE public.analytics_events(id text primary key, event_type text not null, metadata jsonb);
CREATE TABLE public.customer_consents(id text primary key, source_url text, captured_at timestamptz not null default '2026-09-01T12:00:00Z',
 event_sequence bigint not null default 1, updated_at timestamptz not null default '2026-09-01T12:00:00Z');
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER update_customer_consents_updated_at BEFORE UPDATE ON public.customer_consents
 FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.analytics_events(id, event_type, metadata) VALUES
 -- The production shape: click id as its own key at both levels and in the middle of both addresses.
 ('middle', 'event_booking_created', jsonb_build_object(
   'event_id', 'e1', 'seats', 2, 'fbclid', 'IwAR0click', 'utm_source', 'facebook', 'short_code', 'quiz26',
   'source_url', '{PAGE}?{TAGS}&fbclid=IwAR0click&short_code=quiz26#event-booking',
   'attribution', jsonb_build_object('fbclid', 'IwAR0click', 'utm_source', 'facebook',
     'source_url', '{PAGE}?{TAGS}&fbclid=IwAR0click&utm_id=123&short_code=quiz26'))),
 -- Click id first, a second kind later, and no fbclid key.
 ('first', 'event_booking_created', jsonb_build_object(
   'source_url', '{PAGE}?fbclid=IwAR0click&utm_source=facebook&gclid=EAIaIQclick',
   'attribution', jsonb_build_object('source_url', '{PAGE}?gclid=EAIaIQclick&msclkid=m1&utm_source=google'))),
 -- Click id as the only parameter, and no attribution key at all.
 ('alone', 'event_booking_created', jsonb_build_object('fbclid', 'IwAR0click', 'source_url', '{PAGE}?fbclid=IwAR0click')),
 -- Upper case, a look-alike parameter that must stay, and a fragment.
 ('case', 'event_booking_created', jsonb_build_object(
   'source_url', '{PAGE}?myfbclid=keep&FBCLID=IwAR0click#top', 'attribution', 'null'::jsonb)),
 -- No click id anywhere: these must come out byte for byte the same.
 ('tagged', 'event_booking_created', jsonb_build_object('fbclid', null, 'utm_source', 'facebook',
   'source_url', '{PAGE}?{TAGS}', 'attribution', jsonb_build_object('utm_source', 'facebook', 'source_url', '{PAGE}?{TAGS}'))),
 ('untagged', 'event_booking_created', jsonb_build_object('fbclid', null, 'source_url', null, 'attribution', null, 'seats', 4)),
 ('empty', 'event_booking_created', '{{}}'::jsonb),
 ('not_object', 'event_booking_created', '[]'::jsonb),
 ('no_metadata', 'event_booking_created', NULL),
 -- Another event type is out of scope, whatever it holds.
 ('other_type', 'table_booking_created', jsonb_build_object('fbclid', 'IwAR0click', 'source_url', '{PAGE}?fbclid=IwAR0click'));

INSERT INTO public.customer_consents(id, source_url) VALUES
 ('middle', '{PAGE}?{TAGS}&fbclid=IwAR0click&short_code=quiz26'),
 ('alone', '{PAGE}?fbclid=IwAR0click'),
 ('clean', '{PAGE}?{TAGS}'),
 ('path_only', '/events/fbclid-night'),
 ('no_url', NULL);

CREATE TABLE fixture_before AS
 SELECT 'analytics' AS tbl, id, metadata::text AS body, NULL::timestamptz AS updated_at FROM public.analytics_events
 UNION ALL SELECT 'consents', id, source_url, updated_at FROM public.customer_consents;
"""

SNAPSHOT = "SELECT md5(string_agg(tbl || id || coalesce(body, '~') || coalesce(updated_at::text, '~'), '|' ORDER BY tbl, id)) FROM (" \
    "SELECT 'analytics' AS tbl, id, metadata::text AS body, NULL::timestamptz AS updated_at FROM public.analytics_events " \
    "UNION ALL SELECT 'consents', id, source_url, updated_at FROM public.customer_consents) s"


def main():
    with tempfile.TemporaryDirectory(prefix='click-id-clear-') as tmp:
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

        def check(expression, label):
            if sql(f'SELECT ({expression})::text;') != 'true':
                raise RuntimeError('FAIL ' + label)
            print('PASS ' + label)

        def metadata(row):
            return f"(SELECT metadata FROM public.analytics_events WHERE id = '{row}')"

        def consent(row):
            return f"(SELECT source_url FROM public.customer_consents WHERE id = '{row}')"

        def unchanged(tbl, row):
            current = metadata(row) + '::text' if tbl == 'analytics' else consent(row)
            return f"{current} IS NOT DISTINCT FROM (SELECT body FROM fixture_before WHERE tbl = '{tbl}' AND id = '{row}')"

        try:
            sql(SETUP)
            before = sql(SNAPSHOT + ';')

            sql('BEGIN;' + MIGRATION.read_text() + 'ROLLBACK;')
            check(f"({SNAPSHOT}) = '{before}'", 'a rolled-back run changes nothing')

            sql(MIGRATION.read_text())

            check(f"NOT {metadata('middle')} ? 'fbclid' AND NOT ({metadata('middle')}->'attribution') ? 'fbclid'",
                  'the fbclid key is removed at both levels')
            check(f"{metadata('middle')}->>'source_url' = '{PAGE}?{TAGS}&short_code=quiz26#event-booking'",
                  'a click id in the middle of the address goes, the fragment stays')
            check(f"{metadata('middle')}->'attribution'->>'source_url' = '{PAGE}?{TAGS}&utm_id=123&short_code=quiz26'",
                  'the nested address is cleaned the same way')
            check(f"{metadata('middle')} - 'fbclid' - 'source_url' - 'attribution' = "
                  "jsonb_build_object('event_id', 'e1', 'seats', 2, 'utm_source', 'facebook', 'short_code', 'quiz26')",
                  'every other key in the row is kept')
            check(f"{metadata('middle')}->'attribution'->>'utm_source' = 'facebook'", 'campaign tags inside attribution are kept')
            check(f"{metadata('first')}->>'source_url' = '{PAGE}?utm_source=facebook'",
                  'a click id that comes first, and a second kind later, both go')
            check(f"{metadata('first')}->'attribution'->>'source_url' = '{PAGE}?utm_source=google'",
                  'two click ids in a row at the start both go')
            check(f"{metadata('alone')} = jsonb_build_object('source_url', '{PAGE}')",
                  'a click id that is the only parameter leaves the bare page')
            check(f"{metadata('case')}->>'source_url' = '{PAGE}?myfbclid=keep#top'",
                  'upper case is caught and a look-alike parameter is kept')
            check(f"{metadata('case')}->'attribution' = 'null'::jsonb", 'a null attribution stays null')

            for row in ['tagged', 'untagged', 'empty', 'not_object', 'no_metadata', 'other_type']:
                check(unchanged('analytics', row), f'analytics row "{row}" is left exactly as it was')

            check(f"{consent('middle')} = '{PAGE}?{TAGS}&short_code=quiz26'", 'a consent address loses its click id')
            check(f"{consent('alone')} = '{PAGE}'", 'a consent address with only a click id becomes the bare page')
            for row in ['clean', 'path_only', 'no_url']:
                check(unchanged('consents', row), f'consent row "{row}" is left exactly as it was')
            check("(SELECT count(*) FROM public.customer_consents c JOIN fixture_before b ON b.tbl = 'consents' AND b.id = c.id "
                  "WHERE c.updated_at IS DISTINCT FROM b.updated_at) = 2",
                  'only the two changed consent rows have a new updated_at')
            check("(SELECT count(*) FROM public.customer_consents WHERE captured_at <> '2026-09-01T12:00:00Z' OR event_sequence <> 1) = 0",
                  'captured_at and event_sequence are untouched')
            check("(SELECT count(*) FROM public.analytics_events) = 10 AND (SELECT count(*) FROM public.customer_consents) = 5",
                  'no row is deleted')
            check("(SELECT count(*) FROM public.analytics_events WHERE event_type = 'event_booking_created' AND metadata::text ~* 'IwAR0click|EAIaIQclick') = 0",
                  'no click id value is left on any event booking row')
            check("(SELECT count(*) FROM pg_proc WHERE proname IN ('strip_click_ids', 'without_click_ids', 'holds_click_id')) = 0",
                  'the helper functions leave nothing behind')

            after_first = sql(SNAPSHOT + ';')
            sql(MIGRATION.read_text())
            check(f"({SNAPSHOT}) = '{after_first}'", 'a second run changes nothing, not even updated_at')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__':
    main()
