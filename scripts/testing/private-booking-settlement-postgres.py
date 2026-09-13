#!/usr/bin/env python3
"""Run settlement migrations against an isolated Unix-socket PostgreSQL cluster.

Uses a non-PII live-schema snapshot, real PostgreSQL functions and real ledger
constraints. Authentication is a fixture and unrelated production triggers and
foreign keys are deliberately excluded. No connection string or network port is
accepted, so this harness cannot connect to production.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / 'tests/fixtures/private-booking-settlement'
MIGRATIONS = ROOT / 'supabase/migrations'
PG_BIN = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))


def main():
    with tempfile.TemporaryDirectory(prefix='booking-ledger-pg-') as folder:
        work = Path(folder)
        cluster = work / 'db'
        socket = work / 'socket'
        socket.mkdir()
        subprocess.run([str(PG_BIN / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([str(PG_BIN / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'postgres.log'),
                        '-o', f"-k {socket} -c listen_addresses=''", '-w', 'start'], check=True, capture_output=True)
        command = [str(PG_BIN / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-q']

        def sql(source):
            completed = subprocess.run(command, input=source, text=True, capture_output=True)
            if completed.returncode:
                raise RuntimeError(completed.stderr)
            return '\n'.join(line.strip() for line in completed.stdout.splitlines() if 'PASS ' in line)

        try:
            snapshot = json.loads((FIXTURES / 'live-schema-before.json').read_text())
            columns = snapshot['columns'] + json.loads((FIXTURES / 'live-extra-columns.json').read_text())
            setup = """
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('fixture.user_id',true),'')::uuid $$;
CREATE FUNCTION public.user_has_permission(uuid,text,text) RETURNS boolean LANGUAGE sql AS $$
  SELECT $1 IS NOT NULL AND ($2 || '.' || $3) = current_setting('fixture.permission',true) $$;
CREATE TABLE public.customers(id uuid PRIMARY KEY, mobile_number text);
"""
            for table in dict.fromkeys(c['table_name'] for c in columns):
                definitions = []
                for column in [c for c in columns if c['table_name'] == table]:
                    definition = column['column_name'] + ' ' + column['data_type']
                    if column.get('generation_expression'):
                        definition += ' GENERATED ALWAYS AS (' + column['generation_expression'] + ') STORED'
                    elif column['column_default']:
                        definition += ' DEFAULT ' + column['column_default']
                    if column['is_nullable'] == 'NO':
                        definition += ' NOT NULL'
                    definitions.append(definition)
                setup += 'CREATE TABLE public.' + table + '(' + ','.join(definitions) + ');\n'
            # All live CHECKs and keys; unrelated external foreign keys are omitted.
            for constraint in snapshot['constraints']:
                if not constraint['def'].startswith('FOREIGN KEY'):
                    setup += f"ALTER TABLE public.{constraint['tab']} ADD CONSTRAINT {constraint['conname']} {constraint['def']};\n"
            setup += """
ALTER TABLE public.invoice_payments ADD FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;
ALTER TABLE public.private_booking_payments ADD FOREIGN KEY (booking_id) REFERENCES public.private_bookings(id) ON DELETE CASCADE;
ALTER TABLE public.invoice_payments ADD FOREIGN KEY (source_payment_id) REFERENCES public.private_booking_payments(id) ON DELETE SET NULL;
ALTER TABLE public.private_bookings ADD FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);
CREATE UNIQUE INDEX private_bookings_invoice_id_key ON public.private_bookings(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE UNIQUE INDEX invoice_payments_invoice_source_key ON public.invoice_payments(invoice_id, source_payment_id) WHERE source_payment_id IS NOT NULL;
CREATE UNIQUE INDEX invoice_payments_invoice_deposit_key ON public.invoice_payments(invoice_id) WHERE source_kind = 'booking_deposit';
CREATE UNIQUE INDEX invoice_payments_paypal_capture_key ON public.invoice_payments(reference) WHERE source_kind = 'paypal';
CREATE TABLE public.invoice_line_items(id uuid DEFAULT gen_random_uuid(), invoice_id uuid, catalog_item_id uuid,
description text, quantity numeric, unit_price numeric, discount_percentage numeric, vat_rate numeric, display_order integer);
CREATE SEQUENCE fixture_invoice_sequence;
CREATE FUNCTION public.get_and_increment_invoice_series(text) RETURNS TABLE(next_sequence integer)
LANGUAGE sql AS $$ SELECT nextval('fixture_invoice_sequence')::integer $$;
"""
            sql(setup)
            sql((FIXTURES / 'live-functions-before.sql').read_text())
            claims = "SET request.jwt.claims = '{\"role\":\"service_role\"}';\n"
            sql(claims + (FIXTURES / 'regression-before.sql').read_text())
            migration = (MIGRATIONS / '20260905192946_private_booking_invoice_settlement.sql').read_text()
            sql('BEGIN;\n' + migration + '\nROLLBACK;')
            print(sql("SELECT fixture_assert(to_regprocedure('public.private_booking_settlement_rows(uuid)') IS NULL,'DDL rollback removed new helper'); SELECT 'PASS full DDL transaction rollback';"))
            sql('BEGIN;\n' + migration + '\nCOMMIT;')
            print(sql(claims + (FIXTURES / 'regression-after.sql').read_text()))
            repair = (MIGRATIONS / '20260905192951_reconcile_verified_private_booking_capture.sql').read_text()
            sql(claims + 'BEGIN;\n' + repair + '\nCOMMIT;')
            sql(claims + 'BEGIN;\n' + repair + '\nCOMMIT;')
            print(sql(claims + (FIXTURES / 'regression-repair.sql').read_text()))
            # Concurrent entry points take booking then invoice locks. Different
            # capture ids must both survive; the same capture must be stored once.
            captures = [f"SELECT record_invoice_paypal_payment_atomic('00000000-0000-0000-0000-000000000010', 10, 'CONCURRENT-{i % 2}', NULL, '2026-09-04T13:00:00Z');" for i in range(8)]
            processes = [subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in captures]
            for process, statement in zip(processes, captures):
                process.stdin.write(claims + 'SET statement_timeout=\'10s\';' + statement)
                process.stdin.close()
            for process in processes:
                process.wait(timeout=15)
                if process.returncode:
                    raise RuntimeError(process.stderr.read())
            print(sql(claims + "SELECT fixture_assert((SELECT count(*)=2 FROM invoice_payments WHERE reference LIKE 'CONCURRENT-%'), 'concurrent retry uniqueness'); SELECT 'PASS concurrent captures';"))
            # Overlap a manual booking payment and a manual invoice payment.
            left = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            right = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            left.stdin.write(claims + "BEGIN; SELECT record_balance_payment('00000000-0000-0000-0000-000000000020',10,'cash'); SELECT pg_sleep(0.2); COMMIT;")
            left.stdin.close()
            right.stdin.write(claims + "SET statement_timeout='10s'; SELECT record_invoice_payment_transaction('{\"invoice_id\":\"00000000-0000-0000-0000-000000000010\",\"amount\":10,\"payment_method\":\"cash\",\"payment_date\":\"2026-09-04\"}');")
            right.stdin.close()
            for process in (left, right):
                process.wait(timeout=15)
                if process.returncode:
                    raise RuntimeError(process.stderr.read())
            print(sql(claims + "SELECT fixture_assert((SELECT paid_amount=40 FROM invoices WHERE id='00000000-0000-0000-0000-000000000010'), 'concurrent manual ledger total'); SELECT 'PASS concurrent manual booking and invoice payments';"))
            print('PASS isolated PostgreSQL settlement migrations and recovery')
        finally:
            subprocess.run([str(PG_BIN / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__':
    main()
