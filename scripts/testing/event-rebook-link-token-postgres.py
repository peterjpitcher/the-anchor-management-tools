#!/usr/bin/env python3
"""Run the rebook link token migration in an isolated socket-only PostgreSQL database.

guest_tokens is rebuilt with production's columns, constraints, RLS and grants (7 November 2026)
and a few rows of other kinds. The real migration file then runs, and the checks cover: a rolled
back run changes nothing, an event_rebook token is accepted, a second one for the same booking is
refused (the once-per-booking claim), one without a booking is refused, other kinds are untouched,
a second run is a no-op, and the guard refuses a list that has moved on or an anon grant.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261107150000_event_rebook_link_token.sql'

SETUP = r"""
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE TABLE public.bookings(id uuid primary key);
CREATE TABLE public.guest_tokens(
  id uuid primary key default gen_random_uuid(),
  hashed_token text not null unique,
  customer_id uuid not null,
  event_booking_id uuid references public.bookings(id) on delete cascade,
  table_booking_id uuid,
  charge_request_id uuid,
  action_type text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  waitlist_offer_id uuid,
  private_booking_id uuid,
  preorder_cover_id uuid,
  CONSTRAINT guest_tokens_action_type_check CHECK ((action_type = ANY (ARRAY['manage'::text, 'sunday_preorder'::text, 'card_capture'::text, 'payment'::text, 'review_redirect'::text, 'charge_approval'::text, 'waitlist_offer'::text, 'private_feedback'::text, 'private_booking_outcome'::text, 'booking_confirm'::text, 'email_capture'::text, 'preorder_guest'::text])))
);
ALTER TABLE public.guest_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guest_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.guest_tokens TO service_role;

INSERT INTO public.bookings(id) VALUES
 ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
INSERT INTO public.guest_tokens(hashed_token, customer_id, event_booking_id, action_type, expires_at) VALUES
 ('h-manage', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'manage', now() + interval '1 day'),
 ('h-payment', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'payment', now() + interval '1 day'),
 ('h-payment-2', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'payment', now() + interval '1 day');
"""

SNAPSHOT = "SELECT md5(string_agg(hashed_token || action_type, '|' ORDER BY hashed_token) || " \
    "(SELECT string_agg(conname || pg_get_constraintdef(oid), '|' ORDER BY conname) FROM pg_constraint " \
    "WHERE conrelid = 'public.guest_tokens'::regclass) || " \
    "(SELECT string_agg(indexname, '|' ORDER BY indexname) FROM pg_indexes WHERE tablename = 'guest_tokens')) " \
    "FROM public.guest_tokens"

REBOOK = "INSERT INTO public.guest_tokens(hashed_token, customer_id, event_booking_id, action_type, expires_at) " \
    "VALUES ('{hash}', '10000000-0000-0000-0000-000000000001', {booking}, 'event_rebook', now() + interval '14 days');"


def main():
    with tempfile.TemporaryDirectory(prefix='event-rebook-token-') as tmp:
        work = Path(tmp)
        cluster, socket = work / 'data', work / 'socket'
        socket.mkdir()
        subprocess.run([str(PG / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([
            str(PG / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'log'),
            '-o', f"-c listen_addresses='' -c unix_socket_directories='{socket}'", '-w', 'start',
        ], check=True, capture_output=True)
        command = [str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']

        def run(text):
            return subprocess.run(command, input=text, text=True, capture_output=True)

        def sql(text):
            done = run(text)
            if done.returncode:
                raise RuntimeError(done.stderr)
            return done.stdout.strip()

        def check(expression, label):
            if sql(f'SELECT ({expression})::text;') != 'true':
                raise RuntimeError('FAIL ' + label)
            print('PASS ' + label)

        def refused(text, needle, label):
            done = run(text)
            if done.returncode == 0 or needle not in done.stderr:
                raise RuntimeError(f'FAIL {label}: {done.stderr or "accepted"}')
            print('PASS ' + label)

        try:
            sql(SETUP)
            before = sql(SNAPSHOT + ';')

            sql('BEGIN;' + MIGRATION.read_text() + 'ROLLBACK;')
            check(f"({SNAPSHOT}) = '{before}'", 'a rolled-back run changes nothing')

            refused(REBOOK.format(hash='h-early', booking="'00000000-0000-0000-0000-000000000001'"),
                    'guest_tokens_action_type_check', 'before the migration an event_rebook token is refused')

            sql(MIGRATION.read_text())

            sql(REBOOK.format(hash='h-rebook-1', booking="'00000000-0000-0000-0000-000000000001'"))
            check("(SELECT count(*) FROM public.guest_tokens WHERE action_type = 'event_rebook') = 1",
                  'an event_rebook token for a booking is accepted')
            refused(REBOOK.format(hash='h-rebook-1b', booking="'00000000-0000-0000-0000-000000000001'"),
                    'guest_tokens_event_rebook_once', 'a second rebook token for the same booking is refused')
            sql(REBOOK.format(hash='h-rebook-2', booking="'00000000-0000-0000-0000-000000000002'"))
            check("(SELECT count(*) FROM public.guest_tokens WHERE action_type = 'event_rebook') = 2",
                  'another booking gets its own rebook token')
            refused(REBOOK.format(hash='h-rebook-null', booking='NULL'),
                    'guest_tokens_event_rebook_scope_check', 'a rebook token without a booking is refused')
            sql("INSERT INTO public.guest_tokens(hashed_token, customer_id, event_booking_id, action_type, expires_at) "
                "VALUES ('h-payment-3', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'payment', now());")
            check("(SELECT count(*) FROM public.guest_tokens WHERE action_type = 'payment') = 3",
                  'other kinds may still hold several tokens per booking')
            refused("INSERT INTO public.guest_tokens(hashed_token, customer_id, action_type, expires_at) "
                    "VALUES ('h-bad', '10000000-0000-0000-0000-000000000001', 'not_a_kind', now());",
                    'guest_tokens_action_type_check', 'an unknown kind is still refused')

            check("(SELECT relrowsecurity FROM pg_class WHERE oid = 'public.guest_tokens'::regclass)", 'RLS stays on')
            check("NOT has_table_privilege('anon', 'public.guest_tokens', 'SELECT') "
                  "AND NOT has_table_privilege('authenticated', 'public.guest_tokens', 'SELECT')",
                  'anon and authenticated still cannot read guest_tokens')

            after = sql(SNAPSHOT + ';')
            sql(MIGRATION.read_text())
            check(f"({SNAPSHOT}) = '{after}'", 'a second run is a no-op')

            sql("GRANT SELECT ON public.guest_tokens TO anon;")
            refused(MIGRATION.read_text(), 'anon holds a privilege', 'the guard refuses when anon holds a grant')
            sql("REVOKE SELECT ON public.guest_tokens FROM anon;")

            sql("DELETE FROM public.guest_tokens WHERE action_type = 'event_rebook';"
                "ALTER TABLE public.guest_tokens DROP CONSTRAINT guest_tokens_action_type_check;"
                "ALTER TABLE public.guest_tokens ADD CONSTRAINT guest_tokens_action_type_check "
                "CHECK (action_type = ANY (ARRAY['manage'::text, 'something_new'::text, 'payment'::text]));")
            refused(MIGRATION.read_text(), 'has moved on', 'the guard refuses a list that has moved on')
            print('ALL PASS')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
