-- The comment on event_images.qr_width_frac still described 0.12 to 0.28, the
-- range set by 20260906130911_qr_width_range. 20260906185343_event_image_qr_ten_percent
-- then widened the CHECK to 0.1 to 0.4 without updating the comment, so the
-- column has been documenting a range it does not enforce.
--
-- Comment only. No constraint, column or data is touched.
comment on column public.event_images.qr_width_frac is
  'QR width as a fraction of the image width. Enforced range 0.1 to 0.4, which is 21mm to 84mm across a 210mm A4 page. 0.20 is the default. The 40mm poster guidance sits at 0.1905 and is advisory rather than enforced: the editor warns below it and still allows the placement. These bounds are mirrored by QR_MIN_WIDTH_FRAC and QR_MAX_WIDTH_FRAC in src/lib/events/artwork/geometry.ts; the parity test in geometry.test.ts reads whichever migration last set this constraint and compares both bounds numerically.';

-- Fail loudly if the comment and the constraint ever disagree again.
do $$
declare
  v_def text;
  v_comment text;
begin
  select pg_catalog.pg_get_constraintdef(oid) into v_def
  from pg_catalog.pg_constraint
  where conrelid = 'public.event_images'::regclass
    and conname = 'event_images_qr_width_frac_check';

  select col_description('public.event_images'::regclass, ordinal_position) into v_comment
  from information_schema.columns
  where table_schema = 'public' and table_name = 'event_images' and column_name = 'qr_width_frac';

  if v_def is null then
    raise exception 'event_images_qr_width_frac_check is missing';
  end if;

  if v_def not like '%0.1%' or v_def not like '%0.4%' then
    raise exception 'constraint is not the expected 0.1 to 0.4 range, it is: %', v_def;
  end if;

  if v_comment not like '%0.1 to 0.4%' then
    raise exception 'the column comment does not describe the enforced range';
  end if;

  raise notice 'qr_width_frac comment now matches the enforced 0.1 to 0.4 constraint';
end $$;