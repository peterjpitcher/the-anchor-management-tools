-- Widen the QR width range downwards, and tighten it at the top.
--
-- Was 0.1905 to 0.40 (40mm to 84mm on A4). Now 0.12 to 0.28 (25mm to 59mm),
-- which puts the 0.20 default (42mm) at the exact midpoint of the slider rather
-- than hard against the bottom of it.
--
-- Why the floor moves. 0.1905 is the 40mm poster guidance, and it was enforced
-- as a hard floor. In practice 42mm dominated busy artwork, and the smallest
-- the editor would allow was still too big. The guidance has not been thrown
-- away: it is now advisory, the editor warns below it, and the hard floor sits
-- at 25mm, roughly 0.6mm modules, which still prints and scans but wants the
-- reader closer to the poster.
--
-- Why the ceiling moves. 0.40 was 84mm, two fifths of the page, which is not a
-- placement anyone wants. 0.28 keeps the range symmetrical about the default.
--
-- Safe to apply: verified on production before writing this that ZERO rows have
-- qr_width_frac set at all, so nothing existing can violate the tighter
-- ceiling and no backfill is needed.
--
-- Purely a constraint change. No column is added, dropped or altered, and
-- neither event image RPC is touched.

alter table public.event_images
  drop constraint if exists event_images_qr_width_frac_check;

alter table public.event_images
  add constraint event_images_qr_width_frac_check
  check (qr_width_frac >= 0.12 and qr_width_frac <= 0.28);

comment on column public.event_images.qr_width_frac is
  'QR width as a fraction of the image width, 0.12 to 0.28 (25mm to 59mm on A4). The 40mm poster guidance sits at 0.1905 and is advisory rather than enforced: the editor warns below it and still allows the placement. 0.20 is the default and the exact midpoint of the range. These bounds are mirrored by QR_MIN_WIDTH_FRAC and QR_MAX_WIDTH_FRAC in src/lib/events/artwork/geometry.ts, which the composite route imports for its own validation; a test reads this file to prove the two agree.';

-- Prove the constraint is what this file claims, or fail the migration. An
-- ALTER that silently matched nothing would leave the editor able to save a
-- value the database then refuses.
do $$
declare
  v_def text;
  v_rows int;
begin
  select pg_catalog.pg_get_constraintdef(oid) into v_def
  from pg_catalog.pg_constraint
  where conrelid = 'public.event_images'::regclass
    and conname = 'event_images_qr_width_frac_check';

  if v_def is null then
    raise exception 'event_images_qr_width_frac_check is missing after this migration';
  end if;

  if v_def not like '%0.12%' or v_def not like '%0.28%' then
    raise exception 'qr_width_frac constraint did not take the new bounds, it is: %', v_def;
  end if;

  -- Nothing should have been invalidated, but say so rather than assume it.
  select count(*) into v_rows
  from public.event_images
  where qr_width_frac is not null
    and (qr_width_frac < 0.12 or qr_width_frac > 0.28);

  if v_rows <> 0 then
    raise exception '% existing row(s) fall outside the new QR width range', v_rows;
  end if;

  raise notice 'qr_width_frac range is now 0.12 to 0.28, no existing rows affected';
end $$;
