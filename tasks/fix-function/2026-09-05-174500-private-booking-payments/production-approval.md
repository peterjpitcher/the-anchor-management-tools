# Production approval packet

Target: **the-anchor-management-tools**, Supabase project **tfcasgxopxegwrabvwat**, application **management.orangejelly.co.uk**. Identity was rechecked through the repository and Supabase project inventory.

## Exact SQL

The linked complete SQL files, with these SHA-256 checksums, constitute the proposed database changes. Neither has been applied.

- [20260905180000_private_booking_invoice_settlement.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/fix-function/2026-09-05-174500-private-booking-payments/approved-sql/20260905180000_private_booking_invoice_settlement.sql)
  - Migration name: `private_booking_invoice_settlement`
  - SHA-256: `791277922fb5d15b22ed9067d190f81a2716d24babd676ca51720a0536409a79`
- [20260905180100_reconcile_verified_private_booking_capture.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/fix-function/2026-09-05-174500-private-booking-payments/approved-sql/20260905180100_reconcile_verified_private_booking_capture.sql)
  - Migration name: `reconcile_verified_private_booking_capture`
  - SHA-256: `5e97ab0ac17bd19f9d2d43d81ae9b322211a5441c3b73090ea22cdd8f0d3cbb0`

## Effects and risk

The schema migration widens two invoice payment CHECKs; adds/replaces payment calculation, recording, synchronisation, validation, cancellation and refund functions; installs payment, link and price guards; changes function EXECUTE grants; and recreates the existing private booking detail view preserving its columns and security_invoker setting. Every SECURITY DEFINER function replacement, trigger, constraint replacement and grant/revoke in the linked SQL is a high-risk financial or access-control change and is included in this single approval.

The separate repair records only the provider-verified £744.80 capture 62921439S0526370F for INV-003WK. It checks the booking link, invoice total and £250 applied deposit before doing so. Repeating it creates no duplicate. Expected invoice total paid is £994.80 and booking outstanding is £0, with final payment date 4 September 2026. Neither migration charges, refunds or sends a customer message.

The relevant live tables were 32 KB to 256 KB. Constraint, trigger and view changes require brief locks, with a five-second timeout. Payment correction has no destructive rollback after commit. The safer rollout is schema first with the old four-argument routine retained, then the guarded correction, then the application deployment.

## Tested validation and rollback

See [database validation](database-validation.md) for exact runtime results and fixture limitations. The root agent reran the isolated PostgreSQL harness and observed all six PASS results, including concurrent operations and repeated recovery. Application suite, lint, typecheck, production build and actual local page checks are recorded in [report](report.md).

Before commit, exact rollback is `ROLLBACK;`; full DDL rollback was exercised. After commit, preserve all capture and money records. Do not restore the old constraints or delete a real capture. A discovered regression requires a separately approved forward-fix migration, based on read-only inspection of the committed state.

## Approved deployment scope and verification

Approval covers these exact two SQL files/checksums, the forward-fix plan above, and integrating/pushing/deploying the payment changes listed in the report. Pre-existing unrelated local work is excluded.

Apply through the verified Supabase migration tool, rechecking checksums and target first. Capture actual migration versions; re-read changed objects and grants; run the read-only anonymous-access assertion; deploy the application; verify the live invoice and booking both show £994.80 paid and £0 outstanding, the capture appears once with its real date, and provider/deployment logs show no new settlement errors. No additional live charge or customer message is needed for verification.

Status: local only, awaiting exact owner approval.

Approval was granted and both migrations applied. The original approved SQL is archived under approved-sql; active repository migration filenames now match applied history versions. See release-result.md for the deployment record.
