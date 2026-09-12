-- Rollback for 20260912210000_correct_bounce_derived_marketing_opt_outs.sql
--
-- Removes the compensating rows the migration inserted, and nothing else. Every row it wrote
-- carries consent_text_version = 'bounce-opt-out-correction-2026-09-12', which nothing else in
-- the schema uses, so the delete is exact: it cannot reach a real guest consent event.
--
-- Nothing else has to be undone. The migration edited and deleted nothing, and it left
-- `customers.marketing_email_opted_out_at` set on all 9 records, so no sending behaviour
-- changed when it ran and none changes when it is rolled back.
--
-- Running this rollback puts the consent history back to saying those 9 guests asked us to
-- stop, which is not what happened. Only use it if the correction itself was wrong.

do $$
declare
  removed_count integer;
  remaining integer;
begin
  delete from public.customer_consents
  where consent_text_version = 'bounce-opt-out-correction-2026-09-12';

  get diagnostics removed_count = row_count;

  select count(*) into remaining
  from public.customer_consents
  where consent_text_version = 'bounce-opt-out-correction-2026-09-12';

  if remaining <> 0 then
    raise exception '% correction rows remain after the delete', remaining;
  end if;

  raise notice 'Removed % correction rows', removed_count;
end $$;
