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
import sys
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
            precision = {(c['table_name'],c['column_name']):c for c in json.loads((FIXTURES / 'extras-live-precision.json').read_text())}
            setup = """
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('fixture.user_id',true),'')::uuid $$;
CREATE FUNCTION public.user_has_permission(uuid,text,text) RETURNS boolean LANGUAGE sql AS $$
  SELECT $1 IS NOT NULL AND ($2 || '.' || $3) = ANY(string_to_array(current_setting('fixture.permission',true),',')) $$;
CREATE FUNCTION public.is_super_admin(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1 IS NOT NULL AND current_setting('fixture.super_admin',true)='true' $$;
CREATE TABLE public.customers(id uuid PRIMARY KEY, mobile_number text, first_name text, last_name text);
"""
            for table in dict.fromkeys(c['table_name'] for c in columns):
                definitions = []
                for column in [c for c in columns if c['table_name'] == table]:
                    definition = column['column_name'] + ' ' + column['data_type']
                    numeric=precision.get((table,column['column_name']))
                    if numeric and numeric['numeric_precision']: definition+=f"({numeric['numeric_precision']},{numeric['numeric_scale']})"
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
            zero_cost_items_migration = (
                MIGRATIONS / '20260918075730_allow_zero_cost_items_on_invoiced_private_bookings.sql'
            ).read_text()
            sql('BEGIN;\n' + zero_cost_items_migration + '\nROLLBACK;')
            sql('BEGIN;\n' + zero_cost_items_migration + '\nCOMMIT;')
            print(sql(claims + (FIXTURES / 'regression-zero-cost-items.sql').read_text()))
            rollback = (
                ROOT / 'supabase/rollbacks/20260918075730_allow_zero_cost_items_on_invoiced_private_bookings.sql'
            ).read_text()
            sql('BEGIN;\n' + rollback + '\nCOMMIT;')
            print(sql(claims + "SELECT fixture_throws($q$INSERT INTO private_booking_items(booking_id,item_type,description,unit_price) VALUES('c28527fe-a373-460d-85a8-e509b78d6eba','other','Fixture rollback room',0)$q$,'Resolve the linked invoice'); SELECT 'PASS zero-cost item rollback restores the original guard';"))
            sql('BEGIN;\n' + zero_cost_items_migration + '\nCOMMIT;')
            extra = json.loads((FIXTURES / 'extras-live-schema.json').read_text())
            sql('DROP TABLE public.invoice_line_items;')
            setup = ''
            for table in ('invoice_line_items','credit_notes','private_booking_documents'):
                definitions=[]
                for c in [c for c in extra['columns'] if c['table_name']==table]:
                    d=c['column_name']+' '+c['data_type']
                    numeric=precision.get((table,c['column_name']))
                    if numeric and numeric['numeric_precision']: d+=f"({numeric['numeric_precision']},{numeric['numeric_scale']})"
                    if c.get('generation_expression'): d+=' GENERATED ALWAYS AS ('+c['generation_expression']+') STORED'
                    elif c['column_default']: d+=' DEFAULT '+c['column_default']
                    if c['is_nullable']=='NO': d+=' NOT NULL'
                    definitions.append(d)
                setup+='CREATE TABLE public.'+table+'('+','.join(definitions)+');'
            setup+="CREATE TRIGGER linked_invoice_item_prices_guard BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_line_items FOR EACH ROW EXECUTE FUNCTION public.guard_linked_invoice_item_prices();"
            setup+="ALTER TABLE public.private_booking_documents ENABLE ROW LEVEL SECURITY; GRANT SELECT,INSERT,UPDATE,DELETE ON public.private_booking_documents TO authenticated; GRANT SELECT ON public.private_bookings,public.invoices,public.credit_notes TO authenticated; GRANT INSERT,UPDATE ON public.credit_notes TO authenticated;"
            for policy in json.loads((FIXTURES / 'extras-live-document-policies.json').read_text()):
                if policy['schemaname']!='public': continue
                setup+='CREATE POLICY "'+policy['policyname']+'" ON public.private_booking_documents FOR '+policy['cmd']+' TO authenticated'
                if policy['qual']: setup+=' USING ('+policy['qual']+')'
                if policy['with_check']: setup+=' WITH CHECK ('+policy['with_check']+')'
                setup+=';'
            sql(setup)
            migration=(MIGRATIONS / '20260918124021_private_booking_supplementary_invoices.sql').read_text()
            sql('BEGIN;'+migration+'ROLLBACK;')
            sql('BEGIN;'+migration+'COMMIT;')
            rollback=(ROOT / 'supabase/rollbacks/20260918124021_private_booking_supplementary_invoices.sql').read_text()
            sql('BEGIN;'+rollback+'COMMIT;')
            print(sql("SELECT fixture_assert(to_regclass('public.private_booking_charge_batches') IS NULL,'rollback removes unused tables'); SELECT 'PASS unused feature rollback';"))
            sql('BEGIN;'+migration+'COMMIT;')
            print(sql(claims+(FIXTURES / 'regression-extras.sql').read_text()))
            print(sql(claims+(FIXTURES / 'regression-zero-cost-items.sql').read_text()))
            # Concurrent attempts must create one invoice and one captured receipt.
            sql(claims+"SELECT save_private_booking_charge_batch((SELECT id FROM fixture_extras_ids WHERE name='booking'),'00000000-0000-0000-0000-00000000e030',0,'[{\"description\":\"Concurrent extra\",\"quantity\":1,\"unit_price\":25,\"vat_rate\":20}]',CURRENT_DATE+20,NULL,NULL);")
            statements=["SELECT issue_private_booking_charge_batch((SELECT id FROM fixture_extras_ids WHERE name='booking'),'00000000-0000-0000-0000-00000000e030',1,NULL);" for _ in range(6)]
            for phase in range(3):
                processes=[subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for _ in statements]
                for process,statement in zip(processes,statements):
                    process.stdin.write(claims+"SET statement_timeout='10s';"+statement)
                    process.stdin.close()
                phase_outputs=[]
                for process in processes:
                    process.wait(timeout=15)
                    if process.returncode: raise RuntimeError(process.stderr.read())
                    phase_outputs.append(process.stdout.read())
                if phase==2 and sum('\"claimed\": true' in output for output in phase_outputs)!=1: raise RuntimeError('Concurrent delivery must produce exactly one claimed sender')
                statements=["SELECT record_invoice_paypal_payment_atomic((SELECT invoice_id FROM private_booking_charge_batches WHERE id='00000000-0000-0000-0000-00000000e030'),30,'EXTRAS-CONCURRENT',NULL,now());" for _ in range(6)]
                if phase==1: statements=["SELECT claim_private_booking_extra_delivery((SELECT id FROM fixture_extras_ids WHERE name='booking'),(SELECT invoice_id FROM private_booking_charge_batches WHERE id='00000000-0000-0000-0000-00000000e030'),NULL,false);" for _ in range(6)]
            print(sql("SELECT fixture_assert((SELECT count(*)=1 FROM invoice_payments WHERE reference='EXTRAS-CONCURRENT'),'concurrent capture dedup'); SELECT 'PASS concurrent issue, captures and one delivery claim';"))
            print(sql("SELECT fixture_throws($q$"+rollback+"$q$,'Feature data exists'); SELECT 'PASS used feature rollback refused without deleting history';"))
            print('PASS isolated PostgreSQL supplementary invoices')
        finally:
            subprocess.run([str(PG_BIN / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)

if __name__ == '__main__':
    main()
