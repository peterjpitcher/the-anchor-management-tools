# Receipt rule edits keep the description, 12 September 2026

Branch `fix/receipt-rule-edit-keeps-description`, based on origin/main a1ba68db. Nothing is
pushed. Follows the same bug class as the timeclock notes fix (`fix/timeclock-edit-keeps-notes`,
commit 0230decb): an edit form that does not carry a field, written as `?? null`, clears it.

- [x] Confirm the live chain: `receipts/page.tsx` imports `ReceiptsClient.tsx`, which imports
      `_components/ui/ReceiptRules.tsx`. One copy of each, no dead duplicates
- [x] Confirm the defect and which parser feeds the write
- [x] Fix: an absent description leaves the stored one alone, a blank one still clears it
- [x] Check the other optional columns in the same payload against the edit form
- [x] Check every caller of `performUpdateReceiptRule` and `buildRuleWritePayload`
- [x] Tests, red on the old code
- [x] Gates and commit
- [ ] Owner approval to push, merge and deploy

## Results

- The write parses the form in the service (`getRuleFormData` in
  `src/services/receipts/receiptMutations.ts`), not with `getReceiptRuleValidationInput` in
  `src/app/actions/receipts.ts`, which only validates. `buildRuleWritePayload` wrote
  `description: data.description ?? null` for both the insert and the update, and the rule edit
  form has no description input, so every edit cleared `receipt_rules.description`.
- What that lost: the approve-suggestion RPC stamps every approved rule with "Created from
  receipt rule suggestion evidence." (migration 20260714000010), the Jacob Williams wages rule
  and the governed follow-up rules carry seeded descriptions (20260801001400, 20260701000013),
  and `createReceiptRuleFromGroup` can set one on create. The rule list shows
  `rule.description ?? 'Matches: ...'` and the rule search matches on the description, so a
  cleared rule lost its label and stopped matching a search for it.
- Fix: `getRuleDescription` now tells three cases apart: absent field (leave the stored
  description alone), present but blank (clear it), present with text (set it). The schema field
  in `src/lib/validation.ts` became nullable so an explicit clear validates, and
  `queryPreviewReceiptRule`'s parameter type was widened to match (the preview only reads the
  match fields). `includeCreatedBy` was renamed `isInsert`, since it now also says whether an
  absent description means "none yet" (insert) or "unchanged" (update).
- The other optional columns in the payload are all on the edit form, prefilled, so a blank one
  there is a deliberate clear and they are unchanged: `match_description` (cannot be blanked
  alone, the schema requires one match condition), `match_transaction_type`, `match_min_amount`,
  `match_max_amount`, `set_vendor_name`, `set_expense_category`. `vendor_id` is not a form field:
  it is re-resolved from `set_vendor_name`, so it follows that field. `priority` and `kind` are
  written only for a user who can govern rules, which is also the only user who sees those
  inputs, so an ordinary manager's edit leaves them alone.
- Callers: only `createReceiptRule` (insert) and `updateReceiptRule` (update) in
  `src/app/actions/receipts.ts`. `createReceiptRuleFromGroup` goes through `createReceiptRule`.
  The toggle and deactivate paths write only `is_active` and the `deactivated_*` columns. The
  governance service only reads `receipt_rules`.
- Tests: `tests/actions/receiptRuleDescription.test.ts`, five cases through the real actions
  against a one-row fake table. The "keeps the stored description" case failed on the old code
  (it came back null). The existing test in `tests/actions/receiptsActions.test.ts` that pins
  "a blank field clears the column" still passes untouched, which is why the fix distinguishes
  absent from blank rather than treating both as unchanged.
- Gates on Node 20.19.5: lint 0; tsc 0, plus the new test file type-checked on its own because
  `tsconfig.json` excludes `tests/`; `npm test` and `npm run test:utc` 842 files, 7,990 passed,
  2 skipped; cold build passed (155 static pages).

## Found on the way, not changed

- There is now no way to write a rule description from the UI at all: neither the create nor the
  edit form has a description input, so descriptions only come from the suggestion RPC, the
  group-rule path and the seed migrations. Adding an input is a UI decision, not part of this fix.
  Whoever adds one gets the behaviour for free: blank clears, text sets.
- `reviewed_at` and `reviewed_by` are stamped whenever the "Mark reviewed" box is ticked and are
  never cleared, so unticking it does nothing and re-ticking re-dates an earlier review. Same
  shape as the recruitment consent timestamps noted in
  `tasks/timeclock-edit-keeps-notes-2026-09-11.md`. Left alone: clearing a review is a decision
  for the owner.
