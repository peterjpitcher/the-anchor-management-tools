"""Run only against the isolated fixture cluster on /tmp, port 55439."""
import subprocess
import time

PSQL = ['psql', '-h', '/tmp', '-p', '55439', '-d', 'oj_charge_verification', '-v', 'ON_ERROR_STOP=1', '-At']
CHARGE = '00000000-0000-4000-8000-000000000010'
VENDOR = '00000000-0000-4000-8000-000000000020'
AUTH = "SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'; SET test.has_permission='true';"


def query(sql):
    return subprocess.run(PSQL + ['-c', sql], capture_output=True, text=True)


def seed():
    result = query(f"TRUNCATE public.audit_logs, public.oj_recurring_charge_instances, public.oj_billing_runs, public.oj_vendor_recurring_charges CASCADE; INSERT INTO public.oj_vendor_recurring_charges(id,vendor_id,description,amount_ex_vat,created_at) VALUES ('{CHARGE}','{VENDOR}','Concurrency fixture',100,'2026-10-01');")
    assert result.returncode == 0, result.stderr


def wait_for_sleep(label):
    for _ in range(100):
        result = query(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{label}' AND wait_event='PgSleep'")
        if result.stdout.strip() == '1':
            return
        time.sleep(0.02)
    raise AssertionError('Transaction did not reach the held-lock checkpoint')


seed()
held = subprocess.Popen(PSQL + ['-c', AUTH + f"SET application_name='oj_closure_lock'; BEGIN; DO $$ DECLARE preview jsonb; BEGIN preview:=public.oj_end_recurring_charge('{CHARGE}','2026-10-15'); PERFORM public.oj_end_recurring_charge('{CHARGE}','2026-10-15',false,preview); END; $$; SELECT pg_sleep(1); COMMIT;"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
wait_for_sleep('oj_closure_lock')
started = time.monotonic()
billing = query(f"INSERT INTO public.oj_billing_runs(vendor_id,status) VALUES('{VENDOR}','processing')")
assert billing.returncode == 0, billing.stderr
assert time.monotonic() - started > 0.5, 'Billing did not wait for the closure lock'
assert held.communicate(timeout=5)[1] == ''
assert query(f"SELECT end_date FROM public.oj_vendor_recurring_charges WHERE id='{CHARGE}'").stdout.strip() == '2026-10-15'
print('PASS: billing waits for closure and then sees the ended definition')

seed()
held = subprocess.Popen(PSQL + ['-c', f"SET application_name='oj_billing_lock'; BEGIN; INSERT INTO public.oj_billing_runs(vendor_id,status) VALUES('{VENDOR}','processing'); SELECT pg_sleep(1); COMMIT;"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
wait_for_sleep('oj_billing_lock')
closure = query(AUTH + f"SELECT public.oj_end_recurring_charge('{CHARGE}','2026-10-15')")
assert held.communicate(timeout=5)[1] == ''
assert closure.returncode != 0 and 'Billing is in progress' in closure.stderr, closure.stderr
assert query(f"SELECT end_date IS NULL FROM public.oj_vendor_recurring_charges WHERE id='{CHARGE}'").stdout.strip() == 't'
print('PASS: closure waits for billing and refuses without changing the charge')

anon = query(f"SET ROLE anon; SELECT public.oj_end_recurring_charge('{CHARGE}','2026-10-15')")
assert anon.returncode != 0 and 'permission denied for function' in anon.stderr
print('PASS: actual anon role cannot execute the closure RPC')
query('TRUNCATE public.audit_logs, public.oj_recurring_charge_instances, public.oj_billing_runs, public.oj_vendor_recurring_charges CASCADE')
