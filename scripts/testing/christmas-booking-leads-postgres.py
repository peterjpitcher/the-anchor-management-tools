#!/usr/bin/env python3
"""Run the Christmas booking leads migration in an isolated socket-only PostgreSQL database.

The tables it references are rebuilt with just their keys, with production's messaging_flags row
(10 November 2026) and the anon, authenticated and service_role roles. The real migration file then
runs, and the checks cover: a rolled back run changes nothing, a website lead needs an email and a
mobile, the email must be lower-case, lead_ref is unique, one claimed follow-up per email per
season (and a different season or an unclaimed lead is fine), one lapsed_hold lead per booking,
deleting a booking keeps the lead and clears the link, deleting a period removes its leads, RLS is
on, anon and authenticated hold no privilege, and the flag is merged without changing any other.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261110185124_christmas_booking_leads.sql'

SETUP = r"""
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid primary key);
CREATE TABLE public.booking_periods(id uuid primary key);
CREATE TABLE public.customers(id uuid primary key);
CREATE TABLE public.table_bookings(id uuid primary key);
CREATE TABLE public.system_settings(
  key varchar primary key,
  value jsonb not null,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql
  SET search_path = public, pg_catalog AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

INSERT INTO public.booking_periods(id) VALUES
 ('a0000000-0000-0000-0000-000000000001'), ('a0000000-0000-0000-0000-000000000002');
INSERT INTO public.customers(id) VALUES ('c0000000-0000-0000-0000-000000000001');
INSERT INTO public.table_bookings(id) VALUES
 ('b0000000-0000-0000-0000-000000000001'), ('b0000000-0000-0000-0000-000000000002');
INSERT INTO auth.users(id) VALUES ('d0000000-0000-0000-0000-000000000001');
INSERT INTO public.system_settings(key, value) VALUES
 ('messaging_flags', '{"bounce_sms_fallback": true, "event_promo_intro_sms_no_email": false, "table_deposit_hold_reminder": true}'::jsonb),
 ('other_setting', '{"value": 1}'::jsonb);
"""

SNAPSHOT = ("SELECT md5(coalesce(string_agg(key || value::text, '|' ORDER BY key), '') || "
            "coalesce(to_regclass('public.table_booking_leads')::text, 'none')) FROM public.system_settings")

LEAD = ("INSERT INTO public.table_booking_leads(lead_ref, source, booking_period_id, first_name, email, "
        "mobile_e164, booking_date, booking_time, party_size, table_booking_id, follow_up_claimed_at) "
        "VALUES ({ref}, {source}, {period}, 'Sam', {email}, {mobile}, '2026-12-15', '12:00', 12, {booking}, {claimed});")

PERIOD_1 = "'a0000000-0000-0000-0000-000000000001'"
PERIOD_2 = "'a0000000-0000-0000-0000-000000000002'"
BOOKING_1 = "'b0000000-0000-0000-0000-000000000001'"


def lead(ref, source="'website'", period=PERIOD_1, email="'sam@example.com'", mobile="'+447700900123'",
         booking='NULL', claimed='NULL'):
    return LEAD.format(ref=f"'{ref}'", source=source, period=period, email=email, mobile=mobile,
                       booking=booking, claimed=claimed)


def main():
    with tempfile.TemporaryDirectory(prefix='christmas-booking-leads-') as tmp:
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

            sql(MIGRATION.read_text())

            check("(SELECT value FROM public.system_settings WHERE key = 'messaging_flags') = "
                  "'{\"bounce_sms_fallback\": true, \"christmas_lead_follow_up\": true, "
                  "\"event_promo_intro_sms_no_email\": false, \"table_deposit_hold_reminder\": true}'::jsonb",
                  'the follow-up flag is switched on and no other flag changes')
            check("(SELECT value FROM public.system_settings WHERE key = 'other_setting') = '{\"value\": 1}'::jsonb",
                  'other settings are untouched')

            sql(lead('10000000-0000-0000-0000-000000000001'))
            check("(SELECT count(*) FROM public.table_booking_leads) = 1", 'a website lead is saved')
            refused(lead('10000000-0000-0000-0000-000000000001'), 'table_booking_leads_lead_ref_key',
                    'lead_ref is unique, the upsert key')
            refused(lead('10000000-0000-0000-0000-000000000002', email='NULL'), 'table_booking_leads_website_contact_check',
                    'a website lead needs an email')
            refused(lead('10000000-0000-0000-0000-000000000003', mobile='NULL'), 'table_booking_leads_website_contact_check',
                    'a website lead needs a mobile')
            refused(lead('10000000-0000-0000-0000-000000000004', email="'Sam@Example.com'"), 'table_booking_leads_email_check',
                    'an email that is not lower-case is refused')
            refused(lead('10000000-0000-0000-0000-000000000005', mobile="'07700900123'"), 'table_booking_leads_mobile_check',
                    'a mobile that is not E.164 is refused')
            refused(lead('10000000-0000-0000-0000-000000000006', source="'phone'"), 'table_booking_leads_source_check',
                    'an unknown source is refused')
            refused("INSERT INTO public.table_booking_leads(lead_ref, source, booking_period_id, first_name, booking_date, "
                    "booking_time, party_size, resume_token_hash) VALUES ('10000000-0000-0000-0000-000000000007', "
                    "'lapsed_hold', " + PERIOD_1 + ", 'Sam', '2026-12-15', '12:00', 6, 'abc');",
                    'table_booking_leads_resume_token_check', 'a resume token needs its expiry')

            sql(lead('20000000-0000-0000-0000-000000000001', claimed='now()'))
            refused(lead('20000000-0000-0000-0000-000000000002', claimed='now()'), 'table_booking_leads_one_follow_up_per_email',
                    'a second claimed follow-up for the same email in the same season is refused')
            sql("UPDATE public.table_booking_leads SET follow_up_claimed_at = NULL "
                "WHERE lead_ref = '20000000-0000-0000-0000-000000000001';")
            sql("UPDATE public.table_booking_leads SET follow_up_claimed_at = now() "
                "WHERE lead_ref = '10000000-0000-0000-0000-000000000001';")
            refused("UPDATE public.table_booking_leads SET follow_up_claimed_at = now() "
                    "WHERE lead_ref = '20000000-0000-0000-0000-000000000001';",
                    'table_booking_leads_one_follow_up_per_email', 'claiming a second lead for a claimed email is refused')
            sql(lead('20000000-0000-0000-0000-000000000003', period=PERIOD_2, claimed='now()'))
            check("(SELECT count(*) FROM public.table_booking_leads WHERE follow_up_claimed_at IS NOT NULL) = 2",
                  'the same email may be followed up once in another season')

            sql(lead('30000000-0000-0000-0000-000000000001', source="'lapsed_hold'", email='NULL', mobile='NULL',
                     booking=BOOKING_1))
            refused(lead('30000000-0000-0000-0000-000000000002', source="'lapsed_hold'", booking=BOOKING_1),
                    'table_booking_leads_one_per_lapsed_hold', 'one lapsed_hold lead per booking')
            sql(lead('30000000-0000-0000-0000-000000000003', booking=BOOKING_1))
            check("(SELECT count(*) FROM public.table_booking_leads WHERE table_booking_id = " + BOOKING_1 + ") = 2",
                  'a website lead may link to a booking that also has a lapsed_hold lead')

            sql("UPDATE public.table_booking_leads SET updated_at = '2000-01-01' "
                "WHERE lead_ref = '30000000-0000-0000-0000-000000000001';"
                "UPDATE public.table_booking_leads SET call_note = 'rang' "
                "WHERE lead_ref = '30000000-0000-0000-0000-000000000001';")
            check("(SELECT updated_at > '2001-01-01' FROM public.table_booking_leads "
                  "WHERE lead_ref = '30000000-0000-0000-0000-000000000001')", 'updated_at moves on an update')

            sql("DELETE FROM public.table_bookings WHERE id = " + BOOKING_1 + ";")
            check("(SELECT count(*) FROM public.table_booking_leads WHERE lead_ref IN "
                  "('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003') "
                  "AND table_booking_id IS NULL) = 2", 'deleting a booking keeps its leads and clears the link')
            sql("DELETE FROM public.booking_periods WHERE id = " + PERIOD_2 + ";")
            check("(SELECT count(*) FROM public.table_booking_leads WHERE booking_period_id = " + PERIOD_2 + ") = 0",
                  "deleting a period removes that season's leads")

            check("(SELECT relrowsecurity FROM pg_class WHERE oid = 'public.table_booking_leads'::regclass)", 'RLS is on')
            check("NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'table_booking_leads')", 'no policies')
            for role in ('anon', 'authenticated', 'public'):
                check(f"NOT has_table_privilege('{role}', 'public.table_booking_leads', "
                      "'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')",
                      f'{role} holds no privilege on the table')
            check("has_table_privilege('service_role', 'public.table_booking_leads', 'SELECT, INSERT, UPDATE, DELETE')",
                  'service_role can read and write it')
            refused("SET ROLE anon; SELECT count(*) FROM public.table_booking_leads;", 'permission denied',
                    'reading as anon is refused')
            print('ALL PASS')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
