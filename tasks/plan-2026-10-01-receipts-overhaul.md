# Receipts overhaul: build plan and progress

**Spec:** `tasks/spec-2026-10-01-receipts-section-review.md` (v2). **Review folded in:** `docs/reviews/2026-10-01-receipts-spec-developer-review.md`.
**Branch:** `feat/receipts-overhaul`, in the worktree `.claude/worktrees/receipts-review`, cut from `origin/main` at `f19f215e`.
**Rule for every release:** code and tests first; the migration is drafted and tested on a throwaway Postgres (`tests/sql/receipts/run.sh`); nothing is applied to production, pushed or deployed without the owner's go-ahead.

Gate for every release (all must pass, on Node 20):

- `eslint src --max-warnings=0`
- `tsc --noEmit` and `tsc -p tsconfig.tests.json`
- `vitest run` with `TEST_TZ=Europe/London` and with `TEST_TZ=UTC`
- `next build`, cold, with the CI placeholder settings
- `LC_ALL=C ./tests/sql/receipts/run.sh`

## Assumptions carried by the build

Recorded here so they travel with the commits. Each is a working default from spec section 3.1 until the owner rules otherwise.

- W1: the AI writes the vendor only; its category is a proposal a person accepts.
- W2: an unambiguous wage match is classified and closed automatically, as today's payroll rules do.
- W3: status comes from the winning rule; vendor and category fall through to the next rule that sets them.
- W4: the lock date applies to every automated or bulk writer.
- W6: receipts actions pass the actor explicitly; the shared audit service is unchanged.
- W10: running a rule over all history is super admin only.
- Invoice pairing may still move a "can't find" payment to "no receipt required" (the reference-free pass always could); it never moves a completed one, and never a pending one a person reopened.

## Release 1: safety

- [x] 5.0 Field protection policy in one module (`src/lib/receipts/field-protection.ts`)
- [x] 5.1 Rule engine rewritten (`src/services/receipts/receiptAutomation.ts`): never moves a closed status, never replaces a human, import or invoice value, writes only if the payment is unchanged since it was read, dry run, named actor
- [x] 5.1 History run action: scope and chunk validated on the server, "all" needs super admin, permission re-checked each step, dry-run preview and confirmation, default scope pending, on-screen text corrected
- [x] 5.1 Refresh after approve or enable reads every pending payment in id order (was the first 500, unordered)
- [x] 5.2 `apply_receipt_invoice_match`: match, payment update and log in one transaction; `vendor_amount_matched` allowed; `invoice` source; completed payments never downgraded; several invoice numbers recorded for review with no ledger write; export selector updated
- [x] 5.3 `complete_receipt_upload` and `release_receipt_upload_intent`: locked, replay-safe; no object removed on the strength of a browser-supplied path
- [x] 5.4 A rule needs keywords or a bank type; default outcome is "Leave pending" everywhere
- [x] 5.5 Every receipts audit entry names the actor; rule logs name the triggering user; the history run is audited on the server at start, per changing step and at the end
- [x] 5.6 Notes saved by their own action; import warnings and "already imported" shown; status tiles show an error instead of zero; placeholder vendor names rejected; `use server` removed from the OpenAI config and the AI classifier
- [x] A value a person clears keeps the manual source
- [x] Dead code removed: `hardDeleteReceiptRule`, `performHardDeleteReceiptRule`, `runReceiptRuleRetroactively`
- [x] Tests: real rule engine on in-memory rows (27), field protection (5), reconciliation service (9), notes and sources (15), history-run action (12), upload action (8 new), audit actor guard, server-only guard, SQL tests on Postgres 15 including a two-session race
- [x] Migration drafted: `supabase/migrations/20261001140000_receipts_release_1_safety.sql` (not applied)
- [ ] Owner go-ahead, apply the migration, deploy, then run the path on the deployed build

## Release 2: import

- [ ] 6.2 items 1 to 9

## Release 3: vendors

- [ ] 7.2 items 1 to 7

## Release 4: AI

- [ ] 8.2 items 1 to 11

## Release 5: rules management

- [ ] 9.2 items 1 to 10

## Release 6: files, export, workspace and invoices

- [ ] 10.1 to 10.6

## Found along the way, outside this build

- `src/lib/audit-helpers.ts` and `src/lib/rate-limit-server.ts` also start with `use server`. Neither returns a secret, but both are library files exposed as callable actions. Not receipts code, so left alone and reported.
