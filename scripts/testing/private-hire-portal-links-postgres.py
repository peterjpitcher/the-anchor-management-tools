#!/usr/bin/env python3
"""Run the private hire portal links and requested room migration in an isolated socket-only PostgreSQL database.

Release 26 of the customer bookings review of 24 October 2026 (BK-204, BK-188).

On a private_bookings table holding a row, the migration adds portal_links_revoked_at and
requested_space_id empty, ties the room to venue_spaces so removing a room clears the request
instead of failing, and changes no existing row. A rolled-back run changes nothing, a second run is
a no-op, an unknown room id is refused, and part 2 of the rollback drops both columns and the key.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261029083100_private_hire_portal_links_and_requested_room.sql'
ROLLBACK = ROOT / 'tasks/private-hire-tidy/rollback.sql'

SETUP = """
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.venue_spaces (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.private_bookings (id uuid PRIMARY KEY, customer_name text NOT NULL, updated_at timestamptz DEFAULT now());
INSERT INTO venue_spaces VALUES ('20000000-0000-4000-8000-000000000001', 'Function Room'),
  ('20000000-0000-4000-8000-000000000002', 'Garden');
INSERT INTO private_bookings(id, customer_name) VALUES ('10000000-0000-4000-8000-000000000001', 'Existing Booking');
"""


def rollback_part_two():
    text = ROLLBACK.read_text()
    return text[text.index('\n-- 2. '):]


def main():
    with tempfile.TemporaryDirectory(prefix='private-hire-links-') as tmp:
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

        def column(name):
            return ("EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'private_bookings' "
                    f"AND column_name = '{name}')")

        fk = "EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'private_bookings_requested_space_id_fkey')"
        try:
            sql(SETUP)
            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            check(f"NOT {column('portal_links_revoked_at')} AND NOT {column('requested_space_id')} AND NOT {fk}",
                  'a rolled-back run changes nothing')

            sql(MIGRATION.read_text())
            check(f"{column('portal_links_revoked_at')} AND {column('requested_space_id')} AND {fk}", 'both columns and the key are added')
            check("(SELECT data_type FROM information_schema.columns WHERE table_name = 'private_bookings' "
                  "AND column_name = 'portal_links_revoked_at') = 'timestamp with time zone'", 'portal_links_revoked_at is timestamptz')
            check("(SELECT portal_links_revoked_at IS NULL AND requested_space_id IS NULL FROM private_bookings "
                  "WHERE id = '10000000-0000-4000-8000-000000000001')", 'the existing booking is unchanged')

            sql("UPDATE private_bookings SET requested_space_id = '20000000-0000-4000-8000-000000000002', "
                "portal_links_revoked_at = now() WHERE id = '10000000-0000-4000-8000-000000000001';")
            check("(SELECT requested_space_id = '20000000-0000-4000-8000-000000000002' FROM private_bookings)", 'a room can be asked for')
            try:
                sql("UPDATE private_bookings SET requested_space_id = '20000000-0000-4000-8000-000000000099';")
            except RuntimeError as error:
                if 'foreign key' not in str(error):
                    raise
                print('PASS an unknown room is refused')
            else:
                raise RuntimeError('FAIL an unknown room was accepted')
            sql("DELETE FROM venue_spaces WHERE id = '20000000-0000-4000-8000-000000000002';")
            check("(SELECT requested_space_id IS NULL FROM private_bookings)", 'removing the room clears the request instead of failing')

            sql(MIGRATION.read_text())
            check(f"(SELECT count(*) FROM pg_constraint WHERE conname = 'private_bookings_requested_space_id_fkey') = 1",
                  'a second run is a no-op')

            sql(rollback_part_two())
            check(f"NOT {column('portal_links_revoked_at')} AND NOT {column('requested_space_id')} AND NOT {fk}",
                  'the rollback drops both columns and the key')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
