#!/usr/bin/env python3
"""Test the live create RPC and email migration in a disposable local Postgres.

Uses schema metadata only, synthetic contacts, and a Unix socket with no network
listener. External foreign keys, production triggers and RLS are not reproduced.
"""
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path('/opt/homebrew/opt/postgresql@17/bin')
MIGRATION = ROOT / 'supabase/migrations/20260910095523_private_booking_email_apostrophes.sql'


def main():
    snapshot = json.loads((ROOT / 'tests/fixtures/private-booking-email/live-schema.json').read_text())
    with tempfile.TemporaryDirectory(prefix='pb-email-') as folder:
        work = Path(folder)
        socket = work / 's'
        socket.mkdir()
        subprocess.run([str(PG / 'initdb'), '-D', str(work / 'db'), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(work / 'db'), '-l', str(work / 'log'), '-o', f"-k {socket} -c listen_addresses=''", '-w', 'start'], check=True, capture_output=True)

        def sql(statement, succeeds=True):
            result = subprocess.run([str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1'], input=statement, text=True, capture_output=True)
            if succeeds and result.returncode:
                raise AssertionError(result.stderr)
            if not succeeds:
                assert result.returncode and 'chk_email_format' in result.stderr, result.stderr
            return result.stdout.strip()

        def booking(email):
            payload = json.dumps(dict(customer_id='00000000-0000-0000-0000-000000000001', customer_name="Test O'Example", customer_first_name='Test', customer_last_name="O'Example", contact_email=email, contact_phone='+447700900123', event_date='2026-09-15', start_time='18:00', end_time='22:00', guest_count=14, event_type='Location Filming', status='confirmed', deposit_amount=0, deposit_waived=True, deposit_waived_reason='Test waiver', balance_due_date='2026-09-10'))
            return "SELECT create_private_booking_transaction('" + payload.replace("'", "''") + "'::jsonb)->>'contact_email';"

        try:
            for table in ['customers', 'private_bookings', 'private_booking_items']:
                columns = []
                for c in snapshot['columns']:
                    if c['table_name'] != table:
                        continue
                    definition = c['column_name'] + ' ' + c['data_type']
                    if c['generation_expression']:
                        definition += ' GENERATED ALWAYS AS (' + c['generation_expression'] + ') STORED'
                    elif c['column_default']:
                        definition += ' DEFAULT ' + c['column_default']
                    if c['is_nullable'] == 'NO':
                        definition += ' NOT NULL'
                    columns.append(definition)
                sql('CREATE TABLE public.' + table + '(' + ','.join(columns) + ');')
            for c in snapshot['constraints']:
                if not c['definition'].startswith('FOREIGN KEY'):
                    sql('ALTER TABLE public.private_bookings ADD CONSTRAINT ' + c['conname'] + ' ' + c['definition'])
            sql(snapshot['function'])
            sql(booking("test.o'example@example.com"), succeeds=False)
            sql(booking('test+booking@example.com'), succeeds=False)
            assert sql('SELECT count(*) FROM private_bookings') == '0'
            print('PASS before migration: apostrophe and plus rejected, no booking saved')
            migration = MIGRATION.read_text()
            sql('BEGIN;\n' + migration + '\nROLLBACK;')
            sql(booking("test.o'example@example.com"), succeeds=False)
            print('PASS migration transaction rollback restores original rule')
            sql('BEGIN;\n' + migration + '\nCOMMIT;')
            for email in ["test.o'example@example.com", 'test+booking@example.com', 'test@example.com', 'test_name%tag@example.co.uk', None]:
                assert sql(booking(email)) == (email or '')
            print('PASS create RPC saves apostrophe, plus, existing formats and optional email unchanged')
            for email in ['invalid', 'a b@example.com', 'a@@example.com', 'a@example', 'a@example.c']:
                sql(booking(email), succeeds=False)
            assert sql('SELECT count(*) FROM private_bookings') == '5'
            print('PASS malformed addresses rejected without partial booking writes')
            # Restore the old rule without changing newly valid stored addresses.
            original = next(c['definition'] for c in snapshot['constraints'] if c['conname'] == 'chk_email_format')
            sql('BEGIN; ALTER TABLE private_bookings DROP CONSTRAINT chk_email_format, ADD CONSTRAINT chk_email_format ' + original + ' NOT VALID; COMMIT;')
            sql(booking("test.o'example@example.com"), succeeds=False)
            assert sql('SELECT count(*) FROM private_bookings') == '5'
            print('PASS operational rollback preserves saved data and restores old write validation')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(work / 'db'), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__':
    main()
