# Production release result

The approved payment repair is deployed to management.orangejelly.co.uk. Kim Renyard is recorded as fully paid: £250 deposited on 28 August and £744.80 captured on 4 September, totalling £994.80. The verified capture appears once. Invoice INV-003WK is paid and the booking outstanding amount is £0.

## Deployment identity

- PR124 merged after every enabled check passed: https://github.com/peterjpitcher/the-anchor-management-tools/pull/124
- Production commit: 9a9063f6b98f6437a4204c17d96a363af7e20ebf.
- Tested branch commit: b8eaeeade7dd6532a4dcc84ae5b0f7119cff41bd. The merge tree is identical.
- Production deployment: dpl_3B6CKLSevBArw4hx2BfywU5G7Rop, Ready.
- Canonical domain inspection resolves management.orangejelly.co.uk to that same deployment ID.
- A TLS-verified GET to /api/app-version returned the exact production commit above.
- The bounded new-deployment error-log check returned no matching logs.

## Database migrations

Target: the-anchor-management-tools, tfcasgxopxegwrabvwat. Applied through the Supabase migration tool after explicit owner approval. The SQL bytes are unchanged from the approved packet.

- 20260905192946_private_booking_invoice_settlement.sql (approved draft prefix 20260905180000), SHA-256 791277922fb5d15b22ed9067d190f81a2716d24babd676ca51720a0536409a79.
- 20260905192951_reconcile_verified_private_booking_capture.sql (approved draft prefix 20260905180100), SHA-256 5e97ab0ac17bd19f9d2d43d81ae9b322211a5441c3b73090ea22cdd8f0d3cbb0.

Repository filenames match both applied history versions. Original approved draft files are archived locally under approved-sql rather than left as duplicate pending migrations. No migration remains unapplied for this release.

After deployment, the root's service-role read returned paid_amount £994.80, status paid, booking outstanding £0, two payment rows, exactly one verified capture and London final payment date 4 September 2026. All nine anonymous-surface checks passed. Independent read-only verification matched all 21 function bodies, nine triggers, both CHECKs, signatures, grants and the invoker view. Actual anon access was denied. See post-apply-database.md.

## Validation and remaining limit

- Full Node 20 suite and coverage passed: 733 files, 6,325 tests, two skipped. Lines 53.42%, branches 43.01%, functions 60.97%, above required floors.
- Lint, cold types and cold Node 20 production build passed locally. GitHub lint, types, coverage, build and database-contract checks passed; Vercel preview was Ready before merge.
- Isolated PostgreSQL passed DDL rollback, settlement, permissions, conflicts/retries, repeated recovery and concurrent capture/manual payment paths.
- The actual authenticated production invoice page was checked after the database correction: Paid, £994.80 paid, £0 outstanding, and both payment entries. This browser observation preceded the application deployment.
- The local corrected booking screen had already been exercised against live records and synthetic settled-ledger tests passed. The final refreshed production booking screen has NOT yet been visually verified: the computer-use tool reported that the Mac was locked and automatic unlocking failed. No lock bypass was attempted.

No new charge, refund or customer communication was made. Both local and remote release branches were removed after merge; the detached release worktree is retained while final browser verification is pending. The original checkout and unrelated local work were preserved. Investigation reports remain local; the release contains only the 38 payment source/test/migration files listed by PR124, including regenerated affected database function types.

Status: deployment and database repair complete. Final production booking-screen verification remains blocked by the locked Mac. Unlocking the Mac is the only user action needed to finish that check.
