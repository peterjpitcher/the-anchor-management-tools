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
- The vendor picker is alphabetical, not most used first (reason in spec 7.2 item 5).
- Whole-word rule matching is built but off: on live data it only loses correct matches.
- A rule may only leave a payment pending or mark it as needing no receipt.
- Only the person who previewed a run can apply it; undoing a run over pending payments needs manage, over all history super admin.
- Undo of a vendor merge or rename runs newest first; an older one is refused while a later one stands.
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

- [x] 6.2 items 1 to 3 and 6: strict parsers in `src/services/receipts/statementParsing.ts`; every record is a payment or a rejection with its number and reason; one money grammar; dates through `parseStatementDate` in `dateUtils`; identical lines kept with an occurrence number
- [x] 6.2 items 4 and 5: `import_receipt_statement` writes the batch, lines, logs and one `process_receipt_batch` job in one transaction; follow-up in `src/services/receipts/receiptImport.ts` records each step and resumes; repeat upload returns the batch and recovers missed lines; unique index on completed batches; 26 empty legacy batches marked superseded
- [x] 6.2 item 7: missing column named, `.CSV` accepted, Windows-1252 and UTF-16 read, 4 MB limit stated, London time, outcome panel that stays on screen
- [x] 6.2 item 8: `scripts/receipts/import-historic-statements.ts` removed
- [x] 6.2 item 9: tests on the real exports (parsers 74, upload check 9, import service and follow-up 21), SQL tests including two uploads of one file at once
- [x] Found and fixed: bank lines with an empty Details column were dropped (IMP-15). Proven on the 79 real statement files: 6,796 lines before, 6,841 after, none rejected, every existing identity unchanged
- [x] Migration drafted: `supabase/migrations/20261001150000_receipts_release_2_import.sql` (not applied)
- [ ] Owner go-ahead, apply the migration, deploy, run an upload on the deployed build, then D14

## Release 3: vendors

- [x] 7.2 item 1: looser matching key for suggestions only (`src/lib/receipts/vendor-matching.ts`): same name without suffixes, joined words, one name starting another, close spelling
- [x] 7.2 item 2: one resolver (`resolve_receipt_vendor`, `src/services/receipts/receiptVendors.ts`) used by manual edit, bulk apply, both rule forms, the rule engine and invoice pairing; the name saved on a payment is always the vendor's own
- [x] 7.2 item 3: `merge_receipt_vendor`, `rename_receipt_vendor`, `undo_receipt_vendor_operation` with a full before-image in `receipt_vendor_operations`; super admin only; audited
- [x] 7.2 item 4: `/receipts/vendors/manage`: list with status, kind, payments, total, last payment, other names; possible duplicates; confirm, rename, merge, deactivate, kind and default category; recent changes with undo
- [x] 7.2 item 5: a new vendor name is asked about before it is created, on the row, the phone card, the bulk screen and the rule forms
- [x] 7.2 item 6: view `receipt_transaction_vendors`; the three report functions, the vendor month view and expense gaps read it; live totals identical before and after; `vendor_id` on watchlist and reviews
- [x] 7.2 item 7: default category can be set per vendor (used by Release 4)
- [x] Tests: matching (34), vendor service and writers (38), permission matrix and audit (20), row and card prompt (8), reconciliation (3 new), SQL on Postgres 15 (resolver, merge, rename, undo, blocked undo, grants)
- [x] Migration drafted: `supabase/migrations/20261001160000_receipts_release_3_vendors.sql` (not applied)
- [ ] Owner go-ahead, apply the migration, deploy, open the screen on the deployed build, then D3 to D5

## Release 4: AI

- [ ] 8.2 items 1 to 11

## Release 5: rules management

Built before Release 4, which needs its per-field output, run records and lock date.

- [x] 9.2 item 1: one evaluator (`src/lib/receipts/rule-evaluation.ts`) used by the engine and the preview; a preview is stored with each payment's version and applied exactly; it stops if the rule, any rule or the lock date changed
- [x] 9.2 item 2: `receipt_rule_runs` and `receipt_rule_run_changes` with before-images; `apply_receipt_rule_run`, `undo_receipt_rule_run`; every engine write goes through `apply_receipt_rule_change` with its history rows
- [x] 9.2 item 3: lock date in `receipt_settings`, set by super admins, enforced by the evaluator and by the database functions
- [x] 9.2 item 4: rule health (matches, wins, last 90 days, last matched, always beaten by) with filters
- [x] 9.2 item 5: test box
- [x] 9.2 item 6: per-field output; whole-word matcher built and off, with the comparison on screen; commas from a bulk group escaped; a run evaluates every active rule and writes only what the target wins
- [x] 9.2 item 7: duplicate check on create, edit and approve; outcomes limited to pending and no receipt required
- [x] 9.2 item 8 (part): run dialog, rule tools and phone list as components; description field; one on/off control; one action at a time. Proposals panel split with Release 4
- [x] 9.2 item 9: conflicts only for same priority and different result, naming the other rule; refreshed after an approval
- [x] 9.2 item 10: guard test `tests/guards/receipts-no-rules-in-migrations.test.ts`
- [x] Tests: evaluator, matcher, health and identity (42), runs, settings, guards and conflicts (35), permission matrix (25), SQL on Postgres 15 (lock date, single change, run in steps, stale previews, undo with conflicts, grants)
- [x] Live comparison, read only: whole-word matching would change 6 of 8,420 payments, all losing a correct match; per-field output changes none
- [x] Migration drafted: `supabase/migrations/20261001170000_receipts_release_5_rules.sql` (not applied)
- [ ] Owner go-ahead, apply the migration, deploy, run a preview and undo on the deployed build

## Release 6: files, export, workspace and invoices

- [ ] 10.1 to 10.6

## Found along the way, outside this build

- `src/lib/audit-helpers.ts` and `src/lib/rate-limit-server.ts` also start with `use server`. Neither returns a secret, but both are library files exposed as callable actions. Not receipts code, so left alone and reported.
