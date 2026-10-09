#!/usr/bin/env python3
"""Test the already-booked skip in claim_marketing_recipients in a disposable local Postgres.

Hand-written minimal tables holding only the columns the function reads, synthetic people,
and a Unix socket with no network listener. The REAL migration file is applied on top, so
the function, the constraint and the backfill under test come from supabase/migrations.
Triggers, RLS and the send window are not reproduced (the window is stubbed open).
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261009130000_marketing_skip_already_booked.sql'

SCHEMA = """
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.events (id uuid PRIMARY KEY, slug text UNIQUE);
CREATE TABLE public.marketing_settings (id boolean PRIMARY KEY, sends_enabled boolean NOT NULL, frequency_cap_days integer NOT NULL);
CREATE TABLE public.marketing_campaigns (
  id uuid PRIMARY KEY, status text NOT NULL, audience_type text NOT NULL,
  ignores_frequency_cap boolean NOT NULL DEFAULT false, link_map jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE public.customers (
  id uuid PRIMARY KEY, email text, email_status text, marketing_email_opt_in boolean,
  marketing_email_opted_out_at timestamptz, marketing_last_email_at timestamptz,
  marketing_reserved_until timestamptz);
CREATE TABLE public.business_contacts (
  id uuid PRIMARY KEY, email text, eligibility_status text, marketing_status text,
  last_marketing_email_at timestamptz, marketing_reserved_until timestamptz);
CREATE TABLE public.bookings (id serial PRIMARY KEY, customer_id uuid, event_id uuid, status text NOT NULL);
CREATE TABLE public.table_bookings (id serial PRIMARY KEY, customer_id uuid);
CREATE TABLE public.marketing_do_not_contact (email_normalised text, removed_at timestamptz);
CREATE TABLE public.marketing_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL, contact_id uuid, customer_id uuid,
  status text NOT NULL DEFAULT 'pending', skip_reason text, failure_class text, error text,
  attempt_count integer NOT NULL DEFAULT 0, next_attempt_at timestamptz, last_attempt_at timestamptz,
  claimed_at timestamptz, lease_expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT marketing_campaign_recipients_skip_reason_check CHECK (skip_reason IS NULL OR skip_reason = ANY (ARRAY[
    'unsubscribed','suppressed','do_not_contact','frequency_cap','not_eligible','campaign_cancelled'])));
CREATE FUNCTION public.marketing_send_window_open(p_audience_type text) RETURNS boolean LANGUAGE sql AS 'SELECT true';
"""

EVENT = "'e0000000-0000-0000-0000-000000000001'"
OTHER_EVENT = "'e0000000-0000-0000-0000-000000000002'"
SINGLE = "'c0000000-0000-0000-0000-000000000001'"
ROUNDUP = "'c0000000-0000-0000-0000-000000000002'"
DONE = "'c0000000-0000-0000-0000-000000000003'"
UNKNOWN = "'c0000000-0000-0000-0000-000000000004'"
BUSINESS = "'c0000000-0000-0000-0000-000000000005'"


def person(n):
    return f"'a0000000-0000-0000-0000-00000000000{n}'"


SEED = f"""
INSERT INTO marketing_settings VALUES (true, true, 0);
INSERT INTO events VALUES ({EVENT}, 'music-bingo-2026-10-16'), ({OTHER_EVENT}, 'quiz-night-2026-10-21');
INSERT INTO marketing_campaigns (id, status, audience_type, link_map) VALUES
  ({SINGLE}, 'scheduled', 'customer', '{{"https://www.the-anchor.pub/events/music-bingo-2026-10-16": "x", "https://www.the-anchor.pub": "y"}}'),
  ({ROUNDUP}, 'scheduled', 'customer', '{{"https://www.the-anchor.pub/events/music-bingo-2026-10-16": "x", "https://www.the-anchor.pub/events/quiz-night-2026-10-21?utm=1": "y"}}'),
  ({DONE}, 'completed', 'customer', '{{"https://www.the-anchor.pub/events/music-bingo-2026-10-16": "x"}}'),
  ({UNKNOWN}, 'scheduled', 'customer', '{{"https://www.the-anchor.pub/events/not-an-event": "x"}}'),
  ({BUSINESS}, 'scheduled', 'business', '{{"https://www.the-anchor.pub/events/music-bingo-2026-10-16": "x"}}');
INSERT INTO customers (id, email, marketing_email_opt_in) VALUES
  ({person(1)}, 'booked@example.invalid', true), ({person(2)}, 'cancelled@example.invalid', true),
  ({person(3)}, 'other-event@example.invalid', true), ({person(4)}, 'nobooking@example.invalid', true),
  ({person(5)}, 'pending@example.invalid', true), ({person(6)}, 'expired@example.invalid', true);
INSERT INTO business_contacts (id, email, eligibility_status, marketing_status) VALUES
  ({person(9)}, 'business@example.invalid', 'eligible', 'subscribed');
INSERT INTO bookings (customer_id, event_id, status) VALUES
  ({person(1)}, {EVENT}, 'confirmed'), ({person(2)}, {EVENT}, 'cancelled'),
  ({person(3)}, {OTHER_EVENT}, 'confirmed'), ({person(5)}, {EVENT}, 'pending_payment'),
  ({person(6)}, {EVENT}, 'expired');
"""


def main():
    with tempfile.TemporaryDirectory(prefix='mkt-booked-') as folder:
        work = Path(folder)
        socket = work / 's'
        socket.mkdir()
        subprocess.run([str(PG / 'initdb'), '-D', str(work / 'db'), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(work / 'db'), '-l', str(work / 'log'), '-o', f"-k {socket} -c listen_addresses=''", '-w', 'start'], check=True, capture_output=True)

        def sql(statement):
            result = subprocess.run([str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1'], input=statement, text=True, capture_output=True)
            if result.returncode:
                raise AssertionError(result.stderr)
            return result.stdout.strip()

        def outcome(campaign):
            return sql(f"SELECT string_agg(c.email || '=' || r.status || COALESCE('/' || r.skip_reason, ''), ' ' ORDER BY c.email) FROM marketing_campaign_recipients r JOIN customers c ON c.id = r.customer_id WHERE r.campaign_id = {campaign}")

        def send(campaign, audience_column='customer_id', people=range(1, 7)):
            sql(f"UPDATE marketing_campaigns SET status = 'sending' WHERE id = {campaign}")
            for n in people:
                sql(f"INSERT INTO marketing_campaign_recipients (campaign_id, {audience_column}) VALUES ({campaign}, {person(n)})")
            sql('SELECT count(*) FROM claim_marketing_recipients(50)')
            sql(f"UPDATE marketing_campaigns SET status = 'completed' WHERE id = {campaign}")
            sql('UPDATE customers SET marketing_reserved_until = NULL; UPDATE business_contacts SET marketing_reserved_until = NULL')

        try:
            sql(SCHEMA)
            sql(SEED)
            sql(MIGRATION.read_text())

            links = sql("SELECT string_agg(right(id::text, 1) || ':' || COALESCE(right(event_id::text, 1), '-'), ' ' ORDER BY id) FROM marketing_campaigns")
            assert links == '1:1 2:- 3:- 4:- 5:1', links
            print('PASS backfill links a one-event campaign, and leaves a round-up, a finished campaign and an unknown slug alone')

            send(SINGLE)
            got = outcome(SINGLE)
            assert got == ('booked@example.invalid=skipped/already_booked cancelled@example.invalid=sending '
                           'expired@example.invalid=sending nobooking@example.invalid=sending '
                           'other-event@example.invalid=sending pending@example.invalid=skipped/already_booked'), got
            print('PASS a confirmed or part-paid booking is skipped; cancelled, expired, another event and no booking all send')

            send(ROUNDUP)
            assert 'skipped' not in outcome(ROUNDUP), outcome(ROUNDUP)
            print('PASS a round-up with no linked event sends to booked guests as before')

            send(BUSINESS, audience_column='contact_id', people=[9])
            assert sql(f"SELECT status FROM marketing_campaign_recipients WHERE campaign_id = {BUSINESS}") == 'sending'
            print('PASS a business contact is never skipped by the rule')

            sql(f"UPDATE marketing_campaigns SET event_id = NULL WHERE id = {UNKNOWN}; UPDATE marketing_campaigns SET event_id = {EVENT}, status = 'scheduled' WHERE id = {DONE}")
            sql(f"DELETE FROM events WHERE id = {EVENT}")
            assert sql(f"SELECT event_id IS NULL FROM marketing_campaigns WHERE id = {DONE}") == 't'
            print('PASS deleting the event unlinks the campaign instead of blocking or deleting it')

            sql(MIGRATION.read_text())
            print('PASS the migration can be applied twice')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(work / 'db'), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__':
    main()
