-- Document signing: a thirteenth kind, deposit_deduction_agreement (owner decision, 13 October 2026).
--
-- A customer agrees to a proposed deposit deduction on a private booking by signing, or declines
-- with a reason. The General Manager still decides the deduction: nothing here approves one or
-- moves money.
--
-- What this does:
--   1. Lets signing_documents.kind hold 'deposit_deduction_agreement' (the twelve kinds it
--      holds today, plus this one).
--   2. Lets signing_templates.kind hold it too (the eight template kinds, plus this one).
--   3. Adds the template row 'deposit-deduction-agreement', SWITCHED OFF. Its wording has two
--      [[TO CONFIRM: ...]] gaps, and the app refuses to switch a template on, or to send it,
--      while a gap remains.
--
-- Additive only. No table, column, function, grant or policy is added, changed or removed, and
-- no existing row is touched. Each constraint is replaced in ONE statement, so there is never a
-- moment without it. Safe to run twice: the constraints are replaced with the same lists, and
-- ON CONFLICT DO NOTHING on the slug never overwrites wording the owner has since edited.
--
-- Rollback (only once no document of the new kind exists: the last two statements fail, and
-- must fail, while a signing_documents row of this kind is still there):
--
--   BEGIN;
--   DELETE FROM public.signing_templates WHERE slug = 'deposit-deduction-agreement';
--   ALTER TABLE public.signing_templates
--     DROP CONSTRAINT signing_templates_kind_check,
--     ADD CONSTRAINT signing_templates_kind_check CHECK (kind = ANY (ARRAY[
--       'terms_variation'::text, 'policy_acknowledgement'::text, 'deduction_consent'::text,
--       'working_time_opt_out'::text, 'guardian_consent'::text, 'job_offer'::text,
--       'client_agreement'::text, 'supplier_confirmation'::text
--     ]));
--   ALTER TABLE public.signing_documents
--     DROP CONSTRAINT signing_documents_kind_check,
--     ADD CONSTRAINT signing_documents_kind_check CHECK (kind = ANY (ARRAY[
--       'employment_agreement'::text, 'terms_variation'::text, 'policy_acknowledgement'::text,
--       'deduction_consent'::text, 'working_time_opt_out'::text, 'guardian_consent'::text,
--       'job_offer'::text, 'private_booking_contract'::text, 'private_booking_waiver'::text,
--       'quote_acceptance'::text, 'client_agreement'::text, 'supplier_confirmation'::text
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
    'deposit_deduction_agreement'::text
  ]));

ALTER TABLE public.signing_templates
  DROP CONSTRAINT IF EXISTS signing_templates_kind_check,
  ADD CONSTRAINT signing_templates_kind_check CHECK (kind = ANY (ARRAY[
    'terms_variation'::text, 'policy_acknowledgement'::text, 'deduction_consent'::text,
    'working_time_opt_out'::text, 'guardian_consent'::text, 'job_offer'::text,
    'client_agreement'::text, 'supplier_confirmation'::text,
    'deposit_deduction_agreement'::text
  ]));

INSERT INTO public.signing_templates (kind, slug, title, body) VALUES

('deposit_deduction_agreement', 'deposit-deduction-agreement', 'Deposit deduction agreement', $body${{customer_name}}, this is about the booking and damage deposit for {{event_label}} at The Anchor.

## What we propose

We propose to keep {{deduction_amount}} from your deposit of {{deposit_amount}}.

The reason: {{deduction_reason}}

That would leave {{amount_to_return}} to come back to you. [[TO CONFIRM: how and when the rest of the deposit is returned, for example to the card or account it was paid from within 48 hours of your agreement]]

## What signing means

By signing you agree to this deduction from your deposit.

If you do not agree, use Decline and tell us why. The General Manager will then be in touch to talk it through. [[TO CONFIRM: any wording you want about how a disagreement is settled]]$body$)

ON CONFLICT (slug) DO NOTHING;

COMMIT;
