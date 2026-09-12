-- Corrects the 9 consent rows that recorded a bounced email as the guest opting out of marketing.
--
-- APPLIED to production project tfcasgxopxegwrabvwat on 12 September 2026 as migration version
-- 20260912190904 (name: correct_bounce_derived_marketing_opt_outs). This file is the record of
-- the SQL that ran, recovered verbatim from supabase_migrations.schema_migrations. Rollback:
-- supabase/rollbacks/20260912210000_correct_bounce_derived_marketing_opt_outs.sql
--
-- Result: 9 compensating rows written, 0 bounce-derived opt-outs left uncorrected, 55 customer
-- opt-out flags unchanged, reachable email audience unchanged at 253.
--
-- The Resend webhook called ConsentService.recordOptOut for every bounce and provider suppression,
-- so the consent history says 9 guests asked us to stop when none of them did: the provider simply
-- could not deliver. The code path is fixed separately (only a spam complaint records an opt-out).
--
-- History is append-only here, so nothing is edited or deleted. Each affected customer gets one
-- compensating row saying what really happened, with status 'unknown' because these guests never
-- expressed a wish either way. Asserting consent for them would be the same mistake in reverse.
--
-- Deliberately NOT changed: `customers.marketing_email_opted_out_at` stays set, so no marketing
-- resumes to anyone on the strength of this correction. Whether these guests should be contactable
-- again is the owner's decision, and several of them bounced permanently in any case.

do $$
declare
  corrected_count integer;
  still_uncorrected integer;
begin
  insert into public.customer_consents (
    customer_id, channel, purpose, status, legal_basis, source, capture_method,
    consent_text_version, consent_text, metadata, related_entity_type, related_entity_id
  )
  select
    cc.customer_id,
    'email',
    'marketing',
    'unknown',
    'unknown',
    'system_migration',
    'import_attestation',
    'bounce-opt-out-correction-2026-09-12',
    'Correction, 12 September 2026: the earlier opt-out on this record was written automatically from a bounced email, not from anything the guest asked for. Their wish is unknown. Recorded during the guest email review.',
    jsonb_build_object(
      'corrects_consent_id', cc.id,
      'corrects_captured_at', cc.captured_at,
      'reason', 'A delivery failure was recorded as a marketing opt-out.',
      'sending_unchanged', true,
      'note', 'marketing_email_opted_out_at was left as it is, so nothing resumed sending.'
    ),
    'customer',
    cc.customer_id::text
  from public.customer_consents cc
  where cc.channel = 'email'
    and cc.purpose = 'marketing'
    and cc.status = 'opted_out'
    and cc.capture_method = 'provider_event'
    and not exists (
      select 1 from public.customer_consents fix
      where fix.consent_text_version = 'bounce-opt-out-correction-2026-09-12'
        and fix.metadata ->> 'corrects_consent_id' = cc.id::text
    );

  get diagnostics corrected_count = row_count;

  select count(*) into still_uncorrected
  from public.customer_consents cc
  where cc.channel = 'email'
    and cc.purpose = 'marketing'
    and cc.status = 'opted_out'
    and cc.capture_method = 'provider_event'
    and not exists (
      select 1 from public.customer_consents fix
      where fix.consent_text_version = 'bounce-opt-out-correction-2026-09-12'
        and fix.metadata ->> 'corrects_consent_id' = cc.id::text
    );

  if still_uncorrected <> 0 then
    raise exception '% bounce-derived opt-outs are still uncorrected', still_uncorrected;
  end if;

  raise notice 'Corrected % bounce-derived opt-outs', corrected_count;
end $$;
