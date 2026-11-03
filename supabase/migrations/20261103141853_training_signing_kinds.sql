-- Document signing: two kinds for staff training (tasks/plan-2026-11-02-staff-training-build.md,
-- section 2.2).
--
--   training_completion  The learner confirms they have read and understood a course, once
--                        every section check is passed. The document is the certificate.
--   training_signoff     A manager records the practical tasks they watched and signs as the
--                        business; the learner then signs in person.
--
-- Both are generator kinds: the app builds their document, so they have no wording in
-- signing_templates, and signing_templates_kind_check stays as it is (template kinds only).
-- The only place in the database that lists signing kinds is signing_documents_kind_check
-- (checked against migrations and production, 2 November 2026: no enum, and no function that
-- validates a kind).
--
-- What this does: lets signing_documents.kind hold the two new kinds (the thirteen kinds it holds
-- today, in the same order, plus these two).
--
-- Additive only. No table, column, function, grant or policy is added, changed or removed, and
-- no row is touched. The constraint is replaced in ONE statement, so there is never a moment
-- without it. Safe to run twice: the constraint is replaced with the same list.
--
-- Rollback (only once no document of either new kind exists: the statement fails, and must fail,
-- while a signing_documents row of either kind is still there):
--
--   BEGIN;
--   ALTER TABLE public.signing_documents
--     DROP CONSTRAINT signing_documents_kind_check,
--     ADD CONSTRAINT signing_documents_kind_check CHECK (kind = ANY (ARRAY[
--       'employment_agreement'::text, 'terms_variation'::text, 'policy_acknowledgement'::text,
--       'deduction_consent'::text, 'working_time_opt_out'::text, 'guardian_consent'::text,
--       'job_offer'::text, 'private_booking_contract'::text, 'private_booking_waiver'::text,
--       'quote_acceptance'::text, 'client_agreement'::text, 'supplier_confirmation'::text,
--       'deposit_deduction_agreement'::text
--     ]));
--   COMMIT;

BEGIN;

ALTER TABLE public.signing_documents
  DROP CONSTRAINT IF EXISTS signing_documents_kind_check,
  ADD CONSTRAINT signing_documents_kind_check CHECK (kind = ANY (ARRAY[
    'employment_agreement'::text, 'terms_variation'::text, 'policy_acknowledgement'::text,
    'deduction_consent'::text, 'working_time_opt_out'::text, 'guardian_consent'::text,
    'job_offer'::text, 'private_booking_contract'::text, 'private_booking_waiver'::text,
    'quote_acceptance'::text, 'client_agreement'::text, 'supplier_confirmation'::text,
    'deposit_deduction_agreement'::text,
    'training_completion'::text, 'training_signoff'::text
  ]));

COMMIT;
