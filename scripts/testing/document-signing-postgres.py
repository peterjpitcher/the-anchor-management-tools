#!/usr/bin/env python3
"""Test the document signing migrations in a disposable local Postgres.

Applies supabase/migrations/20261013080854_document_signing_foundation.sql to an empty cluster
that has only the Supabase roles and a stand-in storage.buckets table, then checks the rules
that matter: a signature needs the document to have been opened, two people signing at the same
moment complete the document exactly once, a refusal stops the document, the evidence trail
cannot be changed, and nothing is granted to anon or authenticated. It then applies the template
drafts and the deposit deduction agreement kind (20261013170000) and checks those too.

Synthetic data only, on a Unix socket with no network listener.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261013080854_document_signing_foundation.sql'
DRAFTS = ROOT / 'supabase/migrations/20261013080952_document_signing_template_drafts.sql'
DEDUCTION_KIND = ROOT / 'supabase/migrations/20261013170000_signing_deposit_deduction_agreement.sql'

DOC_A = '00000000-0000-0000-0000-0000000000a1'
DOC_B = '00000000-0000-0000-0000-0000000000b1'
DOC_C = '00000000-0000-0000-0000-0000000000c1'
DOC_D = '00000000-0000-0000-0000-0000000000d1'
BOOKING = '00000000-0000-0000-0000-00000000bbbb'
SUBJECT = '00000000-0000-0000-0000-00000000aaaa'
SHA = 'a' * 64


def main():
    # Short prefix: a Unix socket path over 103 bytes fails.
    with tempfile.TemporaryDirectory(prefix='sgn-', dir='/tmp') as folder:
        work = Path(folder)
        socket = work / 's'
        socket.mkdir()
        subprocess.run([str(PG / 'initdb'), '-D', str(work / 'db'), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(work / 'db'), '-l', str(work / 'log'), '-o', f"-k {socket} -c listen_addresses=''", '-w', 'start'], check=True, capture_output=True)

        def psql(statement):
            return subprocess.run([str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1'], input=statement, text=True, capture_output=True)

        def sql(statement):
            result = psql(statement)
            if result.returncode:
                raise AssertionError(result.stderr)
            return result.stdout.strip()

        def fails(statement, expected):
            result = psql(statement)
            assert result.returncode and expected in result.stderr, result.stderr or 'statement succeeded'

        def document(doc_id, version, expires="now() + interval '30 days'"):
            sql(f"""INSERT INTO signing_documents (id, kind, mode, brand, title, subject_type, subject_id, series_key, version, source_pdf_path, source_sha256, expires_at)
                    VALUES ('{doc_id}', 'employment_agreement', 'sign', 'staff', 'Worker agreement', 'employee', '{SUBJECT}', 'employment_agreement', {version}, 'p/{doc_id}.pdf', '{SHA}', {expires});""")

        def party(doc_id, name, viewed=True, token_expires="now() + interval '30 days'"):
            viewed_at = 'now()' if viewed else 'NULL'
            return sql(f"""INSERT INTO signing_parties (document_id, role, name, email, hashed_token, token_expires_at, document_viewed_at)
                           VALUES ('{doc_id}', 'worker', '{name}', 'test@example.com', md5(random()::text), {token_expires}, {viewed_at})
                           RETURNING id;""").splitlines()[0]

        def sign(party_id, method='link'):
            return json.loads(sql(f"SELECT signing_record_signature('{party_id}', 'Test Example', 'I agree.', '{method}', '203.0.113.9', 'test-agent', 'Staines', 'ENG', 'GB');"))

        try:
            sql("""CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
                   CREATE SCHEMA storage;
                   CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false);""")
            migration = MIGRATION.read_text()
            sql(migration)
            # Running it twice must be harmless: every statement is guarded.
            sql(migration)
            assert sql("SELECT public FROM storage.buckets WHERE id = 'signed-documents'") == 'f'
            print('PASS migration applies, applies again, and creates a private bucket')

            for table in ['signing_templates', 'signing_documents', 'signing_parties', 'signing_events']:
                for role in ['anon', 'authenticated']:
                    for privilege in ['SELECT', 'INSERT', 'UPDATE', 'DELETE']:
                        assert sql(f"SELECT has_table_privilege('{role}', 'public.{table}', '{privilege}')") == 'f', (table, role, privilege)
                assert sql(f"SELECT relrowsecurity FROM pg_class WHERE oid = 'public.{table}'::regclass") == 't', table
                assert sql(f"SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = '{table}'") == '0', table
            for function in ['signing_record_signature(uuid, text, text, text, text, text, text, text, text, uuid, uuid)',
                             'signing_record_decline(uuid, text, text, text, text, text, text)']:
                for role in ['anon', 'authenticated', 'public']:
                    assert sql(f"SELECT has_function_privilege('{role}', 'public.{function}', 'EXECUTE')") == 'f', (function, role)
                assert sql(f"SELECT has_function_privilege('service_role', 'public.{function}', 'EXECUTE')") == 't', function
                assert sql(f"SELECT prosecdef FROM pg_proc WHERE oid = 'public.{function}'::regprocedure") == 'f', function
            print('PASS nothing is granted to anon, authenticated or PUBLIC; row security is on with no policy')

            document(DOC_A, 1)
            unopened = party(DOC_A, 'Not Opened', viewed=False)
            first = party(DOC_A, 'First Signer')
            second = party(DOC_A, 'Second Signer')

            assert sign(unopened)['reason'] == 'document_not_viewed'
            assert json.loads(sql(f"SELECT signing_record_signature('{first}', '  ', 'I agree.', 'link');"))['reason'] == 'missing_name_or_agreement'
            assert sql(f"SELECT status FROM signing_documents WHERE id = '{DOC_A}'") == 'sent'
            print('PASS a signature is refused until the document has been opened, and without a name')

            result = sign(first)
            assert result['ok'] and result['document_status'] == 'part_signed' and result['completed'] is False, result
            assert sign(first)['reason'] == 'already_signed'
            assert sql(f"SELECT typed_name || '|' || signed_ip || '|' || signed_city || '|' || method FROM signing_parties WHERE id = '{first}'") == 'Test Example|203.0.113.9|Staines|link'
            # A signed link is spent.
            assert sql(f"SELECT token_expires_at <= now() FROM signing_parties WHERE id = '{first}'") == 't'
            print('PASS first signature recorded with its evidence; signing twice is refused; the link is spent')

            # The last two signers sign at the same moment. Exactly one of them completes it.
            sql(f"UPDATE signing_parties SET document_viewed_at = now() WHERE id = '{unopened}'")
            statement = "SELECT signing_record_signature('{}', 'Test Example', 'I agree.', 'link');"
            racers = [subprocess.Popen([str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-At', '-c', statement.format(p)], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE) for p in (unopened, second)]
            outcomes = [json.loads(r.communicate()[0].strip()) for r in racers]
            assert all(o['ok'] for o in outcomes), outcomes
            assert sorted(o['completed'] for o in outcomes) == [False, True], outcomes
            assert sql(f"SELECT status FROM signing_documents WHERE id = '{DOC_A}'") == 'completed'
            assert sql(f"SELECT count(*) FROM signing_events WHERE document_id = '{DOC_A}' AND event = 'completed'") == '1'
            assert sql(f"SELECT count(*) FROM signing_events WHERE document_id = '{DOC_A}' AND event = 'signed'") == '3'
            print('PASS two people signing at once complete the document exactly once')

            fails(f"UPDATE signing_events SET event = 'opened' WHERE document_id = '{DOC_A}';", 'append-only')
            fails(f"DELETE FROM signing_events WHERE document_id = '{DOC_A}';", 'append-only')
            fails(f"DELETE FROM signing_documents WHERE id = '{DOC_A}';", 'violates foreign key')
            assert sql(f"SELECT count(*) FROM signing_events WHERE document_id = '{DOC_A}'") == '4'
            print('PASS the evidence trail refuses update and delete, and a document with a trail cannot be deleted')

            document(DOC_B, 2)
            refuser = party(DOC_B, 'Refuser')
            other = party(DOC_B, 'Other Signer')
            declined = json.loads(sql(f"SELECT signing_record_decline('{refuser}', ' Not what we agreed ', '203.0.113.9', 'test-agent');"))
            assert declined['ok'] and declined['document_status'] == 'declined', declined
            assert sql(f"SELECT decline_reason FROM signing_parties WHERE id = '{refuser}'") == 'Not what we agreed'
            assert sign(other)['reason'] == 'document_declined'
            assert json.loads(sql(f"SELECT signing_record_decline('{refuser}');"))['reason'] == 'already_declined'
            print('PASS a refusal stops the document, and nobody else can then sign it')

            document(DOC_C, 3)
            late_link = party(DOC_C, 'Late Link', token_expires="now() - interval '1 minute'")
            needs_check = sql(f"""INSERT INTO signing_parties (document_id, role, name, hashed_token, token_expires_at, document_viewed_at, identity_check)
                                  VALUES ('{DOC_C}', 'worker', 'New Starter', md5(random()::text), now() + interval '1 day', now(), 'date_of_birth') RETURNING id;""").splitlines()[0]
            assert sign(late_link)['reason'] == 'link_expired'
            # An in-person session is a short-lived link too, and expires like one.
            assert sign(late_link, method='in_person')['reason'] == 'link_expired'
            # The same person signing in the staff portal is not bound by the link's expiry.
            assert sign(late_link, method='portal')['ok']
            assert sign(needs_check)['reason'] == 'identity_not_checked'
            sql(f"UPDATE signing_parties SET identity_checked_at = now() WHERE id = '{needs_check}'")
            assert sign(needs_check)['completed'] is True
            print('PASS an expired link is refused, portal signing is not, and the date of birth check is enforced')

            sql(f"UPDATE signing_documents SET status = 'sent', expires_at = now() - interval '1 minute', completed_at = NULL WHERE id = '{DOC_B}'")
            sql(f"UPDATE signing_parties SET status = 'pending', declined_at = NULL WHERE id = '{refuser}'")
            assert sign(other)['reason'] == 'document_expired'
            print('PASS an expired request cannot be signed')

            fails(f"UPDATE signing_parties SET status = 'signed' WHERE id = '{refuser}';", 'signing_parties_signed_has_evidence')
            fails(f"""INSERT INTO signing_documents (kind, mode, brand, title, subject_type, subject_id, series_key, version, source_pdf_path, source_sha256, expires_at)
                      VALUES ('employment_agreement', 'sign', 'staff', 'Duplicate', 'employee', '{SUBJECT}', 'employment_agreement', 1, 'p/x.pdf', '{SHA}', now());""", 'uq_signing_documents_series_version')
            fails(f"""INSERT INTO signing_documents (kind, mode, brand, title, subject_type, subject_id, series_key, version, source_pdf_path, source_sha256, expires_at)
                      VALUES ('employment_agreement', 'sign', 'staff', 'Bad fingerprint', 'employee', '{SUBJECT}', 'other', 1, 'p/x.pdf', 'not-a-hash', now());""", 'signing_documents_source_sha256_check')
            print('PASS a party cannot be marked signed without evidence; versions are unique; fingerprints are checked')

            drafts = DRAFTS.read_text()
            sql(drafts)
            assert sql('SELECT count(*) FROM signing_templates') == '12'
            assert sql('SELECT count(*) FROM signing_templates WHERE is_active') == '0'
            assert sql("SELECT count(*) FROM signing_templates WHERE body NOT LIKE '%[[TO CONFIRM:%'") == '0'
            assert sql("SELECT count(*) FROM signing_templates WHERE kind = 'policy_acknowledgement'") == '5'
            # The owner edits a template and switches it on. Applying the drafts again must not undo that.
            sql("UPDATE signing_templates SET body = 'Owner wording, long enough to count as real wording.', is_active = true, version = 2 WHERE slug = 'allergens'")
            sql(drafts)
            assert sql("SELECT body || '|' || is_active || '|' || version FROM signing_templates WHERE slug = 'allergens'") == 'Owner wording, long enough to count as real wording.|true|2'
            assert sql('SELECT count(*) FROM signing_templates') == '12'
            print('PASS twelve draft templates arrive switched off and marked as drafts; re-applying never overwrites edited wording')

            # The deposit deduction agreement kind (20261013170000).
            def kind_document(kind, doc_id='gen_random_uuid()'):
                identifier = doc_id if doc_id.endswith('()') else f"'{doc_id}'"
                return f"""INSERT INTO signing_documents (id, kind, mode, brand, title, subject_type, subject_id, series_key, version, source_pdf_path, source_sha256, expires_at)
                           VALUES ({identifier}, '{kind}', 'sign', 'guest', 'Deposit deduction agreement', 'private_booking', '{BOOKING}', 'deduction:{kind}', 1, 'p/{kind}.pdf', '{SHA}', now() + interval '30 days');"""

            def kind_template(kind, slug):
                return f"INSERT INTO signing_templates (kind, slug, title, body) VALUES ('{kind}', '{slug}', 'Test', 'Test wording.');"

            def kind_checks(table):
                return sql(f"""SELECT count(*) FROM pg_constraint
                               WHERE conrelid = 'public.{table}'::regclass AND contype = 'c' AND conname = '{table}_kind_check' AND convalidated""")

            # Before it is applied, the database refuses the new kind on both tables.
            fails(kind_document('deposit_deduction_agreement'), 'signing_documents_kind_check')
            fails(kind_template('deposit_deduction_agreement', 'too-early'), 'signing_templates_kind_check')
            print('PASS before the migration the new kind is refused on documents and on templates')

            deduction_kind = DEDUCTION_KIND.read_text()
            active_before = sql('SELECT count(*) FROM signing_templates WHERE is_active')
            sql(deduction_kind)
            assert kind_checks('signing_documents') == '1' and kind_checks('signing_templates') == '1'
            sql(kind_document('deposit_deduction_agreement', DOC_D))
            assert sql(f"SELECT kind FROM signing_documents WHERE id = '{DOC_D}'") == 'deposit_deduction_agreement'
            sql(kind_template('deposit_deduction_agreement', 'second-of-its-kind'))
            sql("DELETE FROM signing_templates WHERE slug = 'second-of-its-kind'")
            print('PASS after the migration the new kind is accepted on documents and on templates')

            fails(kind_document('made_up_kind'), 'signing_documents_kind_check')
            fails(kind_template('made_up_kind', 'made-up'), 'signing_templates_kind_check')
            # A kind that has a generator and no template is still refused as a template.
            fails(kind_template('private_booking_contract', 'no-such-template'), 'signing_templates_kind_check')
            # Every kind that was allowed before still is.
            for kind in ['employment_agreement', 'terms_variation', 'policy_acknowledgement', 'deduction_consent', 'working_time_opt_out', 'guardian_consent',
                         'job_offer', 'private_booking_contract', 'private_booking_waiver', 'quote_acceptance', 'client_agreement', 'supplier_confirmation']:
                sql('BEGIN; ' + kind_document(kind) + ' ROLLBACK;')
            print('PASS an unknown kind is still refused on both tables, and the twelve earlier kinds are still accepted')

            row = "kind || '|' || title || '|' || is_active || '|' || version || '|' || (activated_at IS NULL)"
            assert sql(f"SELECT {row} FROM signing_templates WHERE slug = 'deposit-deduction-agreement'") == 'deposit_deduction_agreement|Deposit deduction agreement|false|1|true'
            assert sql("SELECT (length(body) - length(replace(body, '[[TO CONFIRM:', ''))) / length('[[TO CONFIRM:') FROM signing_templates WHERE slug = 'deposit-deduction-agreement'") == '2'
            assert sql('SELECT count(*) FROM signing_templates') == '13'
            # It switched nothing on: the only active template is the one switched on by hand above.
            assert sql('SELECT count(*) FROM signing_templates WHERE is_active') == active_before == '1'
            print('PASS the deposit deduction template exists, switched off, with its two gaps still to confirm')

            # Running it twice is harmless, and never overwrites wording the owner has since edited.
            sql(deduction_kind)
            assert sql('SELECT count(*) FROM signing_templates') == '13'
            assert sql("SELECT count(*) FROM signing_templates WHERE slug = 'deposit-deduction-agreement' AND NOT is_active") == '1'
            sql("UPDATE signing_templates SET body = 'Owner wording for a deduction, long enough to count.', is_active = true, version = 2 WHERE slug = 'deposit-deduction-agreement'")
            sql(deduction_kind)
            assert sql("SELECT body || '|' || is_active || '|' || version FROM signing_templates WHERE slug = 'deposit-deduction-agreement'") == 'Owner wording for a deduction, long enough to count.|true|2'
            assert kind_checks('signing_documents') == '1' and kind_checks('signing_templates') == '1'
            assert sql(f"SELECT count(*) FROM signing_documents WHERE id = '{DOC_D}'") == '1'
            fails(kind_document('made_up_kind'), 'signing_documents_kind_check')
            fails(kind_template('made_up_kind', 'made-up'), 'signing_templates_kind_check')
            print('PASS running the migration again changes nothing: one template row, edited wording kept, both constraints still in force')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(work / 'db'), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__':
    main()
