-- Rollback for 20260923111724_voucher_type_roast_twenty_six.
--
-- Removes the 20% off Sunday roasts type. Safe only while no card has been
-- generated: vouchers.type_id references voucher_types(id) with the default
-- RESTRICT, so the delete fails by itself if any voucher exists. The guard
-- below turns that into a readable message and also refuses when a batch
-- snapshot mentions the type, because a reprint reads the snapshot.
--
-- If cards have already been printed, do not use this. Deactivate instead:
--   update public.voucher_types set active = false, updated_at = now()
--   where id = 'roast-20-six';
-- Inactive types stay redeemable for cards already in the drawer.

do $guard$
declare
  v_count integer;
begin
  select count(*) into v_count from public.vouchers where type_id = 'roast-20-six';
  if v_count > 0 then
    raise exception 'roast-20-six has % voucher(s); deactivate it instead of deleting it', v_count;
  end if;

  select count(*) into v_count
  from public.voucher_batches
  where type_definitions ? 'roast-20-six';
  if v_count > 0 then
    raise exception 'roast-20-six appears in % batch snapshot(s); deactivate it instead', v_count;
  end if;
end
$guard$;

delete from public.voucher_types where id = 'roast-20-six';
