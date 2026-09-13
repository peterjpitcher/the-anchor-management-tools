# QR size database change

Target: the-anchor-management-tools, project tfcasgxopxegwrabvwat, verified against repository .env.local URL and connected project list.

Migration: 20260906155438_event_image_qr_ten_percent.sql

SHA-256: 0c4510089d889d46bd327f18776948a1c990cc1668872a64908097dbcc4eed55

Exact SQL:

```sql
-- Allow the requested 10% minimum and match the editor's existing 40% ceiling.
SET lock_timeout = '3s';
ALTER TABLE public.event_images
  DROP CONSTRAINT event_images_qr_width_frac_check,
  ADD CONSTRAINT event_images_qr_width_frac_check
    CHECK (qr_width_frac >= 0.1 AND qr_width_frac <= 0.4);
RESET lock_timeout;
```

Live findings: event_images contains 70 rows and occupies 147456 bytes. The live check permits 12% to 28%, while the current editor and route permit 20% to 40%. This change permits 10% to 40%. No dependent views or functions referencing qr_width_frac were found. No column shape, grants, policies, triggers, indexes or data are changed.

Risk: replacing the check takes an exclusive table lock and scans 70 existing rows. A three-second lock timeout prevents prolonged waiting. The wider range accepts all existing valid values. No table rewrite or data backfill.

Validation: exact migration executed against isolated local PostgreSQL. Null and existing 12%/28% values preserved; 10%/40% accepted; 9.99%/40.01% rejected. Transactional rollback restored the prior constraint.

Rollback SQL (apply only if no newly saved values lie outside the previous range; otherwise leave the widened constraint and revert application code without changing saved placements):

```sql
BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE public.event_images
  DROP CONSTRAINT event_images_qr_width_frac_check,
  ADD CONSTRAINT event_images_qr_width_frac_check
    CHECK (qr_width_frac >= 0.12 AND qr_width_frac <= 0.28);
COMMIT;
```

Post-apply: read migration history and constraint definition, confirm unchanged row count, then verify 10% in the live branding editor and inspect a freshly saved and downloaded PNG for readable BOOK NOW lettering. No SMS or bookings involved.

Files in this release: ArtworkBrandingModal.tsx and its test; geometry.ts and its test; composite.ts and its test; the composite route and branding-service.test.ts; the new QR size migration; this packet and tasks/todo.md. Unchanged: branding-service.ts (already creates a fresh storage path on every save), image uploads, logo placement behaviour, website code, and all unrelated changes in the original checkout.
