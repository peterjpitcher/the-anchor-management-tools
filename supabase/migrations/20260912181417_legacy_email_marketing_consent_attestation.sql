-- Records the legacy marketing-email consent the owner declared on 12 September 2026.
--
-- The guest email review found that 197 of the 250 people on the marketing list gave their address
-- when no notice mentioned marketing email, and that the stored consent records describe texts only
-- with the basis "unknown". The owner's answer was that consent was given on a previous system, so
-- consent is assumed for all emails and the list is not narrowed.
--
-- This writes that down, so the basis is evidenced rather than assumed. It is deliberately labelled
-- for what it is: status 'legacy', captured as an attestation rather than a capture event, with the
-- declaration itself as the consent text and metadata saying plainly that no capture event exists in
-- this system. It is additive evidence only: it sets no flag, changes no audience and sends nothing.
--
-- Anyone who has opted out is excluded: their choice stands and is the later event either way.
--
-- Applied to production as migration `legacy_email_marketing_consent_attestation`, 12 September
-- 2026: 290 rows. After it, every contactable customer (297, including the 7 explicit opt-ins) has
-- a recorded basis, no opted-out customer was attested, and `marketing_email_opt_in` still reads 7.

do $$
declare
  inserted_count integer;
  eligible_without_row integer;
  opted_out_with_row integer;
begin
  insert into public.customer_consents (
    customer_id, channel, purpose, status, legal_basis, source, capture_method,
    consent_text_version, consent_text, metadata
  )
  select
    c.id,
    'email',
    'marketing',
    'legacy',
    'consent',
    'system_migration',
    'import_attestation',
    'owner-declaration-2026-09-12',
    'Owner declaration, 12 September 2026: consent for marketing email was given on the previous system, before this app kept consent records. Recorded during the guest email review.',
    jsonb_build_object(
      'declared_by', 'owner',
      'declared_on', '2026-09-12',
      'recorded_during', 'guest email review',
      'capture_event_exists', false,
      'note', 'No capture event for this consent exists in this system. The basis is the owner declaration above.'
    )
  from public.customers c
  where coalesce(trim(c.email), '') <> ''
    and c.marketing_email_opted_out_at is null
    and not exists (
      select 1 from public.customer_consents cc
      where cc.customer_id = c.id
        and cc.channel = 'email'
        and cc.purpose = 'marketing'
        and cc.status in ('opted_in', 'legacy')
    );

  get diagnostics inserted_count = row_count;

  select count(*) into eligible_without_row
  from public.customers c
  where coalesce(trim(c.email), '') <> ''
    and c.marketing_email_opted_out_at is null
    and not exists (
      select 1 from public.customer_consents cc
      where cc.customer_id = c.id
        and cc.channel = 'email'
        and cc.purpose = 'marketing'
        and cc.status in ('opted_in', 'legacy')
    );

  select count(*) into opted_out_with_row
  from public.customers c
  join public.customer_consents cc on cc.customer_id = c.id
  where c.marketing_email_opted_out_at is not null
    and cc.consent_text_version = 'owner-declaration-2026-09-12';

  if eligible_without_row <> 0 then
    raise exception 'Still % contactable customers with no recorded email marketing basis', eligible_without_row;
  end if;

  if opted_out_with_row <> 0 then
    raise exception 'Attested consent for % customers who had opted out', opted_out_with_row;
  end if;

  raise notice 'Recorded the declaration for % customers', inserted_count;
end $$;
