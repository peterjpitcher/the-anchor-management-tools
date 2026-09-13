-- Undoes 20260912200000_legacy_email_marketing_consent_attestation.sql.
--
-- Removes only the rows that migration wrote, identified by its own consent text version, so a
-- real consent captured since is never deleted. Consent history is normally append-only, which is
-- why this exists as a rollback rather than as routine housekeeping: use it only if the owner
-- withdraws the declaration.

do $$
declare
  removed_count integer;
begin
  delete from public.customer_consents
  where consent_text_version = 'owner-declaration-2026-09-12'
    and capture_method = 'import_attestation'
    and source = 'system_migration'
    and status = 'legacy';

  get diagnostics removed_count = row_count;
  raise notice 'Removed % attestation rows', removed_count;
end $$;
