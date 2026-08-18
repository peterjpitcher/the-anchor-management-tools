-- Two corrections to Golden Barrels' January 2026 records, plus the flag the
-- Work Record needs to describe a fixed-price invoice honestly.
--
-- Nothing here changes a figure the client has seen. No invoice total moves, no
-- new invoice is raised, and no credit note is issued.
--
-- Background. INV-003VI and INV-003VM were two fixed-price stages for the Dukes
-- Head website build, raised by hand and backdated so the client saw clean
-- invoice dates. Because they were raised outside the monthly billing engine
-- they carry no reference, which is why they dropped out of the client statement
-- until that filter was removed, and the three time entries behind INV-003VI
-- were never linked to it.
--
-- The link is evidenced by timing: INV-003VI was created at 10:13 on 21 January
-- 2026, and the three entries were logged at 11:01:12 the same morning, within
-- half a second of one another. INV-003VM was created a fortnight later and has
-- no time logged against it at all, which is what a second fixed-price stage
-- looks like.

-- 1. A fixed-price invoice is not worth the hours behind it, so the Work Record
--    must not reconcile it against them. Inferring this from the reference text
--    was rejected: a filter on free text is exactly what hid these invoices in
--    the first place.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS is_fixed_price boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.invoices.is_fixed_price IS
  'The invoice was agreed as a fixed price rather than derived from time. The Work Record states the agreed price instead of reconciling it against the hours behind it.';

-- 2. Name the two stages, so they are identifiable rather than anonymous. These
--    are the only two Golden Barrels invoices with no reference at all.
UPDATE public.invoices
   SET reference = 'Dukes Head website, stage 1',
       is_fixed_price = true,
       updated_at = timezone('utc', now())
 WHERE invoice_number = 'INV-003VI'
   AND reference IS NULL;

UPDATE public.invoices
   SET reference = 'Dukes Head website, stage 2',
       is_fixed_price = true,
       updated_at = timezone('utc', now())
 WHERE invoice_number = 'INV-003VM'
   AND reference IS NULL;

-- 3. Attach the three entries to the stage that charged them. Guarded on the
--    invoice link still being absent, so re-running cannot move work that has
--    since been assigned somewhere else.
UPDATE public.oj_entries e
   SET invoice_id = (SELECT id FROM public.invoices WHERE invoice_number = 'INV-003VI'),
       updated_at = timezone('utc', now())
 WHERE e.invoice_id IS NULL
   AND e.vendor_id = (SELECT id FROM public.invoice_vendors WHERE name = 'Golden Barrels Limited')
   AND e.entry_date BETWEEN '2026-01-12' AND '2026-01-14'
   AND e.status = 'paid'
   AND e.description LIKE 'The Dukes Head website%';
