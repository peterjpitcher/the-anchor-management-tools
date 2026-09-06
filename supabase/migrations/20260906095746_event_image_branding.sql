-- Event image branding: where the logo and the QR code sit on an uploaded image.
--
-- Purely additive. Ten nullable columns on public.event_images and their CHECK
-- constraints, and nothing else. Every existing row stays valid, so this is safe
-- to apply ahead of any code deploy and safe to roll code back under.
--
-- The logo can be placed two ways: snapped to a corner (logo_corner) or freely
-- positioned (logo_centre_x_frac and logo_centre_y_frac). Exactly one of the two
-- is allowed per row, enforced by event_images_logo_placement_exclusive.
--
-- `upsert_event_image_variant` and `delete_event_image_variant` are deliberately
-- NOT touched. Neither reads nor writes any column below, and because every new
-- column is nullable their INSERTs keep working exactly as they do today. The
-- branding path calls the existing upsert for the composited file, which already
-- returns the object to clean up, and then issues one small UPDATE for these
-- columns. The two are not atomic; the failure mode is branding metadata missing
-- while the image itself is correct, which is benign.
--
-- ---------------------------------------------------------------------------
-- Why this file adds no grants
-- ---------------------------------------------------------------------------
--
-- Since 20260828120356 a NEW object in public no longer inherits anon access, so
-- a new table or view the website reads needs its own GRANT in the same
-- migration. That rule does not reach this change: these are columns on a table
-- that already exists. public.event_images is one of the twelve tables granted
-- to anon by that same migration, and a table-level GRANT SELECT covers every
-- column of the table, including columns added afterwards. The website therefore
-- keeps reading event_images exactly as it does now, the new columns come along
-- with it, and there is nothing to grant here. Row level security is likewise
-- untouched: its policies filter rows and say nothing about columns. Nothing
-- below is sensitive in any case, it is placement geometry plus a reference to a
-- short link that is public by design.
--
-- ---------------------------------------------------------------------------
-- Why fractions of the image edge, not pixels and not percentages
-- ---------------------------------------------------------------------------
--
-- Every placement value is a fraction of an image edge in the range 0 to 1, and
-- every such column name ends in `_frac`. Uploads vary in resolution: the real
-- posters staff upload run at about 1055x1491, not the nominal A4-at-300dpi
-- 2480x3508 the design assumes. A pixel offset stored against one resolution
-- puts the logo somewhere else entirely on another, whereas a fraction keeps the
-- physical placement correct whatever was uploaded. Percentages are excluded so
-- that a 0-to-1 value and a 0-to-100 value can never describe the same thing;
-- `src/lib/events/artwork/geometry.ts` holds the identical rule on the
-- TypeScript side, and these columns are its storage.

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------

alter table public.event_images
  add column if not exists original_storage_path text,
  add column if not exists logo_corner           text,
  add column if not exists logo_centre_x_frac    numeric,
  add column if not exists logo_centre_y_frac    numeric,
  add column if not exists logo_colour           text,
  add column if not exists logo_width_frac       numeric,
  add column if not exists qr_centre_x_frac      numeric,
  add column if not exists qr_centre_y_frac      numeric,
  add column if not exists qr_width_frac         numeric,
  add column if not exists qr_short_link_id      uuid;

-- ---------------------------------------------------------------------------
-- 2. Per-column constraints
--
-- A CHECK passes when its expression is null, so every one of these is
-- automatically satisfied by an unbranded row and no backfill is needed. Each is
-- dropped before it is added so re-running the file is safe.
-- ---------------------------------------------------------------------------

alter table public.event_images
  drop constraint if exists event_images_logo_corner_check;
alter table public.event_images
  add constraint event_images_logo_corner_check
  check (logo_corner in ('top_left', 'top_right', 'bottom_left', 'bottom_right'));

-- Only two logo files exist (`public/guest/anchor-logo-white.png` and its black
-- twin), so the vocabulary is closed at two values rather than being a colour.
alter table public.event_images
  drop constraint if exists event_images_logo_colour_check;
alter table public.event_images
  add constraint event_images_logo_colour_check
  check (logo_colour in ('white', 'black'));

-- 0.08 to 0.35, matching LOGO_MIN_WIDTH_FRAC and LOGO_MAX_WIDTH_FRAC in
-- src/lib/events/artwork/geometry.ts. Below 0.08 the logo is unreadable at
-- social sizes. The ceiling is where it stops being real resolution: the logo
-- artwork is 934px wide, the largest canvas produced is the 2480px A4 poster,
-- and 2480 * 0.35 = 868px, still inside the 934px the file actually contains.
-- Anything wider upscales the source and the edges go soft in print.
alter table public.event_images
  drop constraint if exists event_images_logo_width_frac_check;
alter table public.event_images
  add constraint event_images_logo_width_frac_check
  check (logo_width_frac >= 0.08 and logo_width_frac <= 0.35);

-- Free logo placement, as a fraction of each edge. The compositor clamps the
-- resulting rectangle so the logo cannot hang off the canvas, so a centre near
-- an edge is legal and simply pulls the logo back inside.
alter table public.event_images
  drop constraint if exists event_images_logo_centre_x_frac_check;
alter table public.event_images
  add constraint event_images_logo_centre_x_frac_check
  check (logo_centre_x_frac >= 0 and logo_centre_x_frac <= 1);

alter table public.event_images
  drop constraint if exists event_images_logo_centre_y_frac_check;
alter table public.event_images
  add constraint event_images_logo_centre_y_frac_check
  check (logo_centre_y_frac >= 0 and logo_centre_y_frac <= 1);

-- The centre point staff dragged the code to, as a fraction of the width and of
-- the height. 0 and 1 are both allowed: the compositor clamps the resulting
-- square back inside the canvas margin, so a centre parked on an edge is a
-- legitimate request and not a corrupt value.
alter table public.event_images
  drop constraint if exists event_images_qr_centre_x_frac_check;
alter table public.event_images
  add constraint event_images_qr_centre_x_frac_check
  check (qr_centre_x_frac >= 0 and qr_centre_x_frac <= 1);

alter table public.event_images
  drop constraint if exists event_images_qr_centre_y_frac_check;
alter table public.event_images
  add constraint event_images_qr_centre_y_frac_check
  check (qr_centre_y_frac >= 0 and qr_centre_y_frac <= 1);

-- The floor is 0.1905, not 0.19, and the extra digit is the whole point. The
-- app's designer guidance states a 40mm minimum for a poster QR, the size a
-- phone camera reliably locks onto from arm's length on a wall. A4 is 210mm
-- wide, so the minimum as a fraction is 40 / 210 = 0.190476... Rounding that
-- DOWN to 0.19 would admit a code that prints at 39.9mm, fractionally under the
-- figure we tell designers we hold to, and a QR that is too small is only ever
-- discovered after it has been printed. So the stored floor rounds up.
-- The 0.40 ceiling is a sanity guard rather than a print rule: a code wider than
-- two fifths of the image is not a placement, it is a mistake.
alter table public.event_images
  drop constraint if exists event_images_qr_width_frac_check;
alter table public.event_images
  add constraint event_images_qr_width_frac_check
  check (qr_width_frac >= 0.1905 and qr_width_frac <= 0.40);

-- On delete set null, not cascade. Retiring a short link must never delete the
-- artwork row; it just leaves a placement whose destination has gone, which the
-- UI can report and staff can repoint.
alter table public.event_images
  drop constraint if exists event_images_qr_short_link_id_fkey;
alter table public.event_images
  add constraint event_images_qr_short_link_id_fkey
  foreign key (qr_short_link_id) references public.short_links(id) on delete set null;

-- No index on qr_short_link_id on purpose. The only cost of leaving it unindexed
-- is the scan of event_images when a short link is deleted, and event_images
-- holds sixty rows. An index here would be dead weight to maintain.

-- ---------------------------------------------------------------------------
-- 3. Table-level constraints
-- ---------------------------------------------------------------------------

-- A logo is placed one of two ways, and never both. `logo_corner` snaps it into
-- a corner with a standard inset, which is what most artwork wants. The centre
-- fractions place it anywhere, for artwork whose composition leaves no usable
-- corner. Storing both would leave the compositor to guess which one the person
-- meant, so exactly one is allowed. Neither set means no logo on this image.
--
-- The centre pair is all or nothing for the same reason the QR pair is: an x
-- without a y cannot be drawn, so it can only be the residue of a partial write.
alter table public.event_images
  drop constraint if exists event_images_logo_placement_exclusive;
alter table public.event_images
  add constraint event_images_logo_placement_exclusive
  check (
    -- no logo
    (logo_corner is null and logo_centre_x_frac is null and logo_centre_y_frac is null)
    or
    -- snapped to a corner
    (logo_corner is not null and logo_centre_x_frac is null and logo_centre_y_frac is null)
    or
    -- freely positioned
    (logo_corner is null and logo_centre_x_frac is not null and logo_centre_y_frac is not null)
  );

-- A placed logo has to be drawn in one of the two files and there is no sensible
-- default: white over a dark poster, black over a light one, and the wrong
-- choice is invisible until it prints. So a placement without a colour, or
-- without a size, is rejected whichever way it was placed.
-- The reverse is deliberately NOT required. A colour with no placement is an
-- unused preference left behind when someone cleared the logo, and forcing a
-- placement to exist for it would turn a harmless leftover into a failed UPDATE.
alter table public.event_images
  drop constraint if exists event_images_logo_colour_required_with_corner;
alter table public.event_images
  drop constraint if exists event_images_logo_colour_required_with_placement;
alter table public.event_images
  add constraint event_images_logo_colour_required_with_placement
  check (
    (logo_corner is null and logo_centre_x_frac is null)
    or (logo_colour is not null and logo_width_frac is not null)
  );

-- The three QR fields are all or nothing. A code needs both a centre and a size
-- before it can be drawn at all, so two of the three set is always a bug: it
-- means an earlier write was partial, and the compositor would have to invent
-- the missing value or silently skip the code. Either all three are null, which
-- is "no QR on this image", or all three are set.
alter table public.event_images
  drop constraint if exists event_images_qr_all_or_nothing;
alter table public.event_images
  add constraint event_images_qr_all_or_nothing
  check (
    (qr_centre_x_frac is null and qr_centre_y_frac is null and qr_width_frac is null)
    or
    (qr_centre_x_frac is not null and qr_centre_y_frac is not null and qr_width_frac is not null)
  );

-- ---------------------------------------------------------------------------
-- 4. Column documentation
-- ---------------------------------------------------------------------------

comment on column public.event_images.original_storage_path is
  'The untouched upload, kept so branding is always composited from the original and never from the previous composite. Without it a second edit would stamp a logo onto an image that already carries one and the placement would compound on itself. Null means no branding has been applied and storage_path IS the original; when set, storage_path points at the composite that is served.';

comment on column public.event_images.logo_corner is
  'Which corner the venue logo is anchored to: top_left, top_right, bottom_left or bottom_right. Set only when the logo is snapped to a corner. Null, with the centre fractions also null, means no logo on this image.';

comment on column public.event_images.logo_centre_x_frac is
  'Logo centre across the width, 0 to 1, when the logo is freely positioned rather than snapped to a corner. Mutually exclusive with logo_corner. Fractions rather than pixels so the placement survives whatever resolution was actually uploaded.';

comment on column public.event_images.logo_centre_y_frac is
  'Logo centre down the height, 0 to 1, when the logo is freely positioned rather than snapped to a corner. Mutually exclusive with logo_corner.';

comment on column public.event_images.logo_colour is
  'Which logo file to draw, white or black. Required whenever the logo is placed, either way; a colour left behind with no placement is simply unused.';

comment on column public.event_images.logo_width_frac is
  'Logo width as a fraction of the image width, 0.08 to 0.35. The ceiling keeps the logo inside the 934px its source artwork actually contains, so it is never upscaled and never softens in print.';

comment on column public.event_images.qr_centre_x_frac is
  'Horizontal centre of the QR code as a fraction of the image width, 0 to 1. A fraction rather than pixels because uploads vary in resolution and the physical placement must survive that.';

comment on column public.event_images.qr_centre_y_frac is
  'Vertical centre of the QR code as a fraction of the image height, 0 to 1.';

comment on column public.event_images.qr_width_frac is
  'QR width as a fraction of the image width. The 0.1905 floor is the 40mm poster minimum at A4 (40 / 210 = 0.190476, rounded up so a code can never print under 40mm). The 0.40 ceiling is a sanity guard.';

comment on column public.event_images.qr_short_link_id is
  'The short link the QR code resolves to, so scans are counted against a real link rather than a bare URL. Set null if that link is ever deleted; the artwork row survives with a placement whose destination has gone.';

-- ---------------------------------------------------------------------------
-- 5. Prove the shape, or fail this migration
--
-- An ALTER that matches nothing still reports success, so without this a typo in
-- a column name would leave the feature quietly half-built. The RPC check is the
-- one that matters most: this migration claims not to touch them, and this is
-- what makes that claim testable rather than a comment.
-- ---------------------------------------------------------------------------

do $$
declare
  v_columns    int;
  v_not_null   int;
  v_checks     int;
  v_anon_read  boolean;
  v_rpcs       int;
begin
  select count(*), count(*) filter (where a.attnotnull)
    into v_columns, v_not_null
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.event_images'::regclass
    and not a.attisdropped
    and a.attname in (
      'original_storage_path', 'logo_corner', 'logo_centre_x_frac',
      'logo_centre_y_frac', 'logo_colour', 'logo_width_frac',
      'qr_centre_x_frac', 'qr_centre_y_frac', 'qr_width_frac', 'qr_short_link_id'
    );

  if v_columns <> 10 then
    raise exception 'expected 10 branding columns on event_images, found %', v_columns;
  end if;

  -- Nullability is the reason the untouched RPCs keep working. If any of these
  -- ever became NOT NULL the existing INSERTs would start failing.
  if v_not_null <> 0 then
    raise exception '% branding column(s) came out NOT NULL; the existing RPC inserts would break', v_not_null;
  end if;

  select count(*) into v_checks
  from pg_catalog.pg_constraint
  where conrelid = 'public.event_images'::regclass
    and contype = 'c'
    and conname in (
      'event_images_logo_corner_check',
      'event_images_logo_centre_x_frac_check',
      'event_images_logo_centre_y_frac_check',
      'event_images_logo_colour_check',
      'event_images_logo_width_frac_check',
      'event_images_qr_centre_x_frac_check',
      'event_images_qr_centre_y_frac_check',
      'event_images_qr_width_frac_check',
      'event_images_logo_placement_exclusive',
      'event_images_logo_colour_required_with_placement',
      'event_images_qr_all_or_nothing'
    );

  if v_checks <> 11 then
    raise exception 'expected 11 branding CHECK constraints on event_images, found %', v_checks;
  end if;

  -- The website reads this table with the anon key. Adding columns must not have
  -- disturbed that, and this fails loudly if it somehow did.
  v_anon_read := pg_catalog.has_table_privilege('anon', 'public.event_images', 'SELECT');
  if not v_anon_read then
    raise exception 'anon lost SELECT on event_images; the public website would 401';
  end if;

  -- Both variant RPCs must still be present with their original signatures.
  --
  -- oidvectortypes, not pg_get_function_identity_arguments. The latter includes
  -- PARAMETER NAMES ('p_event_id uuid, p_variant text, ...'), so comparing it
  -- against a bare type list never matches. This assertion was originally
  -- written the other way and passed against a local stub whose parameters
  -- happened to be unnamed, then failed the moment it met the real functions.
  -- Types are what a caller actually binds to, so types are what is asserted.
  select count(*) into v_rpcs
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (
      (p.proname = 'upsert_event_image_variant'
        and pg_catalog.oidvectortypes(p.proargtypes)
            = 'uuid, text, text, text, text, text, integer, uuid')
      or
      (p.proname = 'delete_event_image_variant'
        and pg_catalog.oidvectortypes(p.proargtypes) = 'uuid, text')
    );

  if v_rpcs <> 2 then
    raise exception 'the event image variant RPCs are not both intact (found %)', v_rpcs;
  end if;

  raise notice 'event image branding: 10 nullable columns, 11 checks, anon read intact, both RPCs untouched';
end $$;
