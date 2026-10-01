# Receipts section: review findings and improvement spec v2

**Date:** 1 October 2026 (v2, same day as v1)
**Status:** Owner decisions and the developer review are folded in. Build authorised by the owner on 1 October 2026. Production migrations, data corrections and deployment still need the owner's go-ahead at the time.
**Replaces:** v1 of this file and the recommendations in `docs/reviews/2026-10-01-receipts-spec-developer-review.md` (findings RV-01 to RV-19). That review stays as history. Where it differs from this document, this document wins. Section 15 maps every review finding to where it is handled.
**Scope:** everything under `/receipts`: statement import, AI classification and vendor naming, rules and rules management, the workspace, receipt files, the quarterly export, invoice reconciliation, permissions and audit.
**How it was checked:** five independent read-only code audits, then every headline claim re-checked by hand against the code and against production with read-only queries on 1 October 2026. **Live** means a production figure from that day. **Code** means traced in code and not executed. The developer review added executed repros for the upload race and the amount parser.

Path short names (all under the repository root):

| Short | Path |
|---|---|
| ACT | `src/app/actions/receipts.ts` |
| MUT | `src/services/receipts/receiptMutations.ts` |
| QRY | `src/services/receipts/receiptQueries.ts` |
| GOV | `src/services/receipts/receiptGovernance.ts` |
| HLP | `src/services/receipts/receiptHelpers.ts` |
| REC | `src/services/receipts/receiptInvoiceReconciliation.ts` |
| AIC | `src/lib/receipts/ai-classification.ts` |
| OAI | `src/lib/openai.ts` |
| RM | `src/lib/receipts/rule-matching.ts` |
| EXP | `src/app/api/receipts/export/route.ts` |
| UI | `src/app/(authenticated)/receipts` |
| RULES | `UI/_components/ui/ReceiptRules.tsx` |
| BULK | `UI/_components/ReceiptBulkReviewClient.tsx` |
| MIG | `supabase/migrations` |

---

## 1. Summary

### 1.1 Verdict

The section works day to day and its foundations are sound: permissions are checked on every action, the tables are locked to the service role, the receipts bucket is private, bulk apply and suggestion approval are atomic, and the matching engine is deterministic and tested. It is not yet at an outstanding standard. Six things hold it back.

1. **One button can undo checked work.** Running a rule over "all historical" changes the status of closed payments although the screen says it will not. Production logs show 281 closed payments were moved this way (273 in October 2025, 6 in August 2026), 19 of which had a receipt attached. All 281 are closed again today.
2. **AI vendor naming has stopped reaching the payments.** Since the June rework the AI writes nothing onto a payment. It only proposes rules, in a queue that is desktop only, super admin only and tucked inside the rules card. 68 proposals are waiting and none has ever been approved or declined. Of the 218 payments imported on 1 October, 44 have no vendor.
3. **The proposals themselves are not safe to approve.** 27 of the 68 use a keyword that does not appear in the payment they came from, 17 match nothing at all, 10 would match more than 50 payments (one keyword matches 1,352), and 5 would name the vendor "null".
4. **There is no single tidy vendor list.** 262 vendors exist, 235 unconfirmed, with about 25 near-duplicate pairs. There is no merge, rename or alias screen, and reports group vendors three different ways.
5. **The audit trail does not say who.** 1,423 of 1,429 receipts audit entries have no user. Every rule-applied log row has no user.
6. **Failures are quiet.** Import warnings never reach the screen, unreadable statement lines are dropped uncounted, AI failures finish as "completed", and a live bug in invoice auto-pairing threw on 26 August and 1 October without anyone seeing it.

### 1.2 What gets built

Six releases. Release 1 goes first. The stated dependencies are real: nothing later may be built on an assumption that an earlier release is absent.

| Release | Delivers | Migration | Needs |
|---|---|---|---|
| 1. Safety | Automation can no longer change closed payments or human decisions; invoice pairing is atomic and its live bug is fixed; upload completion cannot lose a file; every receipts audit entry names a user; import warnings are shown | 1 | nothing |
| 2. Import | Every statement record is accounted for; strict money and dates; an interrupted import resumes, including its follow-up work | 1 | Release 1 |
| 3. Vendors | One vendor list with confirm, rename, merge, aliases and undo; every writer and report uses it | 1 | Release 1 |
| 4. AI | The AI names the vendor on each payment from the vendor list and proposes a category; wage payments are recognised locally; failures are visible; rule proposals are checked against real text | 1 | Releases 1 and 3, and the per-field rule output in 9.2 item 6 |
| 5. Rules management | Exact preview bound to what will run, undo for a run, a lock date for filed periods, rule health, a test box, tidier matching | 1 | Release 1 |
| 6. Files, export, workspace and invoices | Duplicate-file warning; "completed" means something; the export is one consistent, audited pack; matched invoices are attached automatically; list and bulk fixes | 1, plus 1 cron | Release 1 |

Data corrections are in section 12. Each changes live data and needs the owner's explicit yes, apart from D1, which was approved on 1 October 2026.

### 1.3 Done means

1. **Release 1:** a rule run on any scope leaves the status, the "marked by" fields and every human-decided vendor or category of a payment exactly as they were, and a human edit made while a run is in flight survives, both proved by tests. The reconciliation job stores a `vendor_amount_matched` row and its payment update in one transaction. Two simultaneous "complete upload" calls, a replayed call and a forged path all leave exactly one attachment with a readable file. Every new receipts row in `audit_logs` has a `user_id`. A repeat upload of a statement shows "already imported", not a success.
2. **Release 2:** for any statement, accepted + rejected = data records in the file, and inserted + duplicates = accepted, and the screen shows all four numbers. `12abc`, `1,23`, `02/13/2026`, `31/02/2026` and `01/02/26` are rejected with the record number. Stopping the process after the import commits and before its follow-up work runs, then re-uploading, completes the follow-up work once.
3. **Release 3:** merging vendor A into vendor B moves every payment, rule, suggestion and watch entry in one transaction and can be undone. After the merge an import, an existing rule run and an old suggestion approval all write B, never A. No report shows A and B as separate vendors.
4. **Release 4:** after an import, each unclassified money-out payment has an AI vendor where one could be identified, or a visible reason there is none. Nothing the AI writes replaces a value set by a rule, a person, the import or invoice pairing. A captured outgoing request contains no employee name. A model outage produces a visible failure count and automatic retries, not a green tick.
5. **Release 5:** the preview lists the exact payments a rule would change, with before and after values. The run changes only those payments, skipping and counting any that changed since the preview. A run can be undone by its id without overwriting later edits. Payments dated on or before the lock date are untouched by every bulk writer.
6. **Release 6:** attaching a file already attached elsewhere produces a warning naming the other payment before anything is written. The export pack's manifest, CSV, files and audit entry agree with each other, and a missing file is listed in the pack. Every payment matched to an invoice has that invoice attached.

---

## 2. Decisions this spec keeps

Earlier decisions that still stand.

1. The AI never closes a status (v2 design section 1.3).
2. Receipt vendors are separate from invoice vendors (v2 design section 1.4).
3. Approving, declining, prioritising and permanently deleting rules is super admin only (v2 design section 1.5).
4. Duplicate payments are reviewed, never voided (v2 design section 1.6).
5. Rule order is priority, longest keyword, type, direction, amount limits, oldest (v2 design section 4).
6. Deleting a rule deactivates it.
7. An expense category applies only to money going out.
8. Rules do not require a bank transaction type, because Amex lines have none.
9. Amex model: one table with `source_type`, an explicit Bank or Amex choice at upload, purchases need a receipt, fees and payments do not, values set at import are locked against rules and AI.
10. The same file is never imported twice.
11. The bank parser stays strict about column names. Release 2 improves the error message only.
12. The category list is fixed at 24 and tied to the P&L.
13. A mileage failure fails the whole quarterly pack.
14. "Can't find" is not counted as outstanding (changed deliberately on 1 May 2026).
15. Reading the contents of receipt documents is out of scope.

---

## 3. Owner decisions, 1 October 2026

| # | Decision | Effect |
|---|---|---|
| O1 | A rule run over history never changes the status of a closed payment and never replaces a vendor or category a person entered. | 5.1 |
| O2 | "Completed" needs an attached file or a written reason. | 10.2 |
| O3 | Where the AI can identify the vendor, it is written onto the payment as the vendor name, provided a rule has not already set it. This supersedes June rework decision B for vendors: the AI now writes a vendor without a person accepting it first. | 8.2 |
| O4 | Wage payments are recognised from the employee list, not one rule per person, and are not sent to OpenAI. | 8.2 item 7 |
| O5 | There is one vendor list with merge and rename, and the AI picks from it. | 7.2, 8.2 |
| O6 | A "locked before" date protects filed periods from rule runs and bulk changes. | 9.2 item 3 |
| O7 | The NEST payments are pension contributions and belong under Total Staff, not under "Nest Heating" in Heat/Light/Power. | 12, D1 |
| O8 | Payments such as Greene King, HMRC and drawings get an explicit "no category applies" marker now. New categories remain a separate decision. | 8.2 item 4 |
| O9 | Any payment that ties to an invoice has that invoice attached automatically. | 10.6 |

### 3.1 Working defaults not yet ruled on

The build proceeds on these. Each is the reviewer's or the author's recommended position. A different ruling changes only the section noted.

| # | Default | Affects |
|---|---|---|
| W1 | The AI writes the vendor only. Its category is shown on the payment as a proposal for one-click acceptance, recorded as "AI accepted". Where the chosen vendor has a default category set by a person, that category is the one proposed. | 8.2 items 3 and 4 |
| W2 | An unambiguous wage match (employee name plus the payroll reference pattern) is classified and marked no receipt required automatically, as today's payroll rules do. Anything ambiguous is held for a person. | 8.2 item 7 |
| W3 | "Leave pending" on a rule is an explicit choice. Status always comes from the winning rule. Vendor and category fall through to the next matching rule when the winner does not set them. | 9.2 item 6 |
| W4 | The lock date applies to every automated or bulk writer: rule runs, the pending refresh, bulk apply, AI writes, "accept all" and invoice pairing. Vendor rename and merge may still correct the name on locked payments, audited. Single manual edits are allowed with a warning. | 9.2 item 3 |
| W5 | On a vendor merge, a review marked "action required" on either vendor is kept, and watch entries are combined. The originals are kept for undo. | 7.2 item 3 |
| W6 | Receipts actions pass the acting user to the audit service explicitly. The shared audit service is not changed for the rest of the app. | 5.5 |
| W7 | Statement dates must be real calendar dates in `DD/MM/YYYY` or `YYYY-MM-DD`, with a four-digit year, not more than one day in the future. There is no fixed earliest date. | 6.2 item 2 |
| W8 | Statement records that cannot be read are listed and the rest of the file is imported. | 6.2 item 1 |
| W9 | A declined rule proposal stays declined. | 8.2 item 8 |
| W10 | Running a rule over all history is super admin only. | 5.1 |
| W11 | Attaching a file that is already on another payment warns and allows. | 10.1 |
| W12 | A payment matched to an invoice is marked completed once the invoice is attached. Until then it stays "no receipt required" with the invoice number as the reason. | 10.6 |

---

## 4. Verified facts (production, 1 October 2026)

### 4.1 Size and state

| Fact | Figure |
|---|---|
| Payments held | 8,420 (8,284 bank, 136 Amex), 18 February 2019 to 30 September 2026 |
| Status | 7,743 completed, 504 no receipt required, 163 pending, 10 can't find |
| 2026 payments | 1,094 (804 money out). Largest quarter 394 rows |
| Imports | 130 batches (123 bank, 7 Amex). Largest 2026 batch 136 rows, average 80 |
| Receipt files | 510, largest 20.6 MB, none HEIC. Q3 2026: 69 files, 12 MB |
| Rules | 187 (180 active). 39 payroll, 126 standard. 173 of the 180 sit at priority 1000 |
| Rule outcomes | 108 leave pending, 72 mark as no receipt required |
| Vendors | 262: 22 confirmed, 235 unconfirmed, 5 inactive. 100 have one payment, 16 have none |
| Vendor aliases | 262, exactly one per vendor, never read by the app |
| AI rule proposals | 68 pending (16 July to 1 October 2026). 0 approved, 0 declined, ever |
| AI spend on receipts | USD 0.27 in 12 months (2,485 calls, model `gpt-4o-mini`). 2,293 of those calls came from loading the bulk page |
| Audit entries for receipts | 1,429, of which 1,423 have no user |
| Invoice matches | 27 payments, all money in. 25 tie to a real invoice. None has the invoice attached |

### 4.2 Where vendor and category come from (2026 payments)

| Source | Vendor | Category |
|---|---|---|
| Rule | 986 | 619 |
| Manual | 8 | 57 |
| AI (legacy, before June) | 39 | 30 |
| Import (Amex fees and payments) | 16 | 5 |
| None | 45 | 383 |

"None" for category includes the 290 money-in payments, which do not take a category. In 2026, 99 money-out payments have no category: 53 marked no receipt required (£117,630, mostly Greene King, HMRC and directors' drawings, which rules deliberately leave uncategorised), 43 pending (£20,100) and 3 completed. The P&L only counts categorised payments (`src/services/financials.ts:628-636`), so those amounts are in no P&L line. O8 gives them an explicit marker; it does not change the P&L.

### 4.3 How it works today, in brief

**Import.** The user picks Bank or Amex and a CSV. The server parses it, checks the file hash against earlier batches, inserts a batch row, upserts the lines on a hash (duplicates ignored), applies rules to the new lines, then queues four kinds of job: AI classification in chunks of ten, invoice reconciliation, a duplicate-candidate refresh, and rule conflict detection. The queue is drained every minute by `/api/jobs/process`. There is no receipts cron.

**Rules.** A rule has comma-separated keywords (any one matches), a direction, optional amount limits and optional bank type. Keywords of three characters or fewer need a word boundary; longer ones match anywhere in the text. One rule wins per payment. It sets vendor, category and status, and records itself on the payment. On import only pending payments are touched and hand-entered values are kept.

**AI.** One model call per ten payments. The prompt carries ten recent manual examples, the 24 categories and the payments. It does not carry the vendor list. Results under 70 confidence are dropped. The rest become rule proposals with a single keyword. Nothing is written to the payment.

**Vendors.** A vendor row is created as a side effect whenever a rule, a manual edit or a bulk apply uses a name whose key has not been seen. The key is the name lower-cased, trimmed and with internal whitespace collapsed. Nothing else is normalised.

**Files.** The browser uploads straight to a private bucket through a signed URL tied to an "upload intent". Completing the upload hashes the file, stores the row and marks the payment completed. The hash is stored and never compared.

**Invoices.** A job looks for inward payments that quote an invoice number, or that match an open invoice by vendor and amount. It records the invoice payment, marks the bank payment "no receipt required" and stores a match record. Invoice PDFs are rendered on demand and are not stored against the payment.

**Export.** One request builds the quarter's CSV and zips every receipt, the OJ Projects invoices, mileage files and (for super admins) expenses, in memory.

---

## 5. Release 1: safety

No new screens. Fixes what can damage data or hides who did what.

### 5.0 The protection policy every writer follows

This is the contract the rest of the spec relies on (review RV-03, RV-04).

**Sources.** Each of vendor and category carries a source. In order of authority: `manual` and `ai_accepted` (a person decided), `import` (set by the Amex import), `invoice` (set by invoice pairing), `rule`, `ai`, none. A deliberate blank counts as a decision: when a person clears a value, the source stays `manual`; a "no category applies" marker (8.2 item 4) is a category decision with the source of whoever set it.

| Writer | May write vendor or category when the current source is | May change status |
|---|---|---|
| A person editing one payment | anything | yes |
| Bulk apply by a person | none, `ai`, `rule`, `invoice`; never `manual`, `ai_accepted` or `import` unless those rows are explicitly included | no |
| Invoice pairing | none, `ai`, `rule`, `invoice` | only from pending or can't find, and never a pending payment a person reopened |
| A rule, on import or refresh | none, `ai`, `rule` | only from pending, and not where a person reopened it (`marked_method = 'manual'`) |
| A rule, run over history | none, `ai`, `rule` | never on a non-pending payment |
| The AI | none only | never |

**At the write.** Every automated or bulk update carries the payment's `updated_at` from when it was read and updates only if it still matches. A payment that changed in between is skipped and counted as a conflict. Results always separate applied, unchanged, protected, locked, conflicted and failed.

**Who.** Every such write records the user who triggered it, or a named system actor for jobs with the initiating user kept alongside.

### 5.1 Rule runs over history

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| RUL-01 | Critical | Scope "all" changes the status of closed payments. The screen says "We can re-check historical records without reopening completed items." "Run Historical" defaults to "all". | ACT:1180-1185; MUT:417-429; RULES:659, :880. **Live:** 281 payments moved from a closed status by rule runs: 249 from no receipt required to pending, 24 from completed to pending, 2 from completed to no receipt required, 6 from can't find to no receipt required (25 August 2026). 19 had a file attached. All 281 are closed today (280 completed, 1 no receipt required), because a later bulk change closed everything before 2026. |
| RUL-02 | High | The same run clears who marked the payment, even when the status does not change. | MUT:424-428, 433-440 |
| RUL-03 | High | Scope "all" replaces hand-entered vendors and categories with no warning. | ACT:1183; MUT:390-391. **Live:** no instance found. |
| RUL-04 | High | The step action trusts `scope` and `chunkSize` from the browser and needs only `receipts.manage`. Updates filter by id after reading state, so an edit made in between is overwritten. | ACT:1098-1110; MUT:352-391, 476-481 |
| RUL-09 | Medium | A payment reopened by hand is closed again by the next rule refresh. | MUT:416-432 never reads `marked_method` |

**Change**

1. Remove `overrideManual` and `allowClosedStatusUpdates`. All rule writes follow 5.0.
2. Write `marked_*` only when the status actually changes.
3. Validate on the server: `scope` is `pending` or `all`; `chunkSize` is clamped to 1 to 200; scope `all` requires super admin (W10). Permission is re-checked on every step.
4. A dry-run mode of the same function returns the counts by outcome. The confirmation dialog shows them before anything is written. Release 5 upgrades this to an exact row preview bound to the run.
5. Correct the on-screen text.

**Tests (not mocking `applyAutomationRules`):** a completed payment with a file, a no-receipt payment, a can't-find payment, a manually reopened pending payment, a payment with a hand-entered vendor, a payment whose category a person cleared, and an Amex fee with an import category. After a scope "all" run of a matching rule only rule-set, AI-set or never-set fields change. A second test changes a payment between read and write and asserts it is reported as a conflict and left alone.

### 5.2 Invoice reconciliation

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| REC-01 | High | Pairing an inward payment to an invoice without a reference writes the status `vendor_amount_matched`, which the database CHECK constraint rejects. The payment is updated first, then the match record fails, so the provenance is lost and the job errors. The quarterly export's invoice selector does not include that status either. | REC:654-684; `MIG/20260701000012:11`; `src/lib/receipts/export/oj-project-invoices.ts:182`. **Live:** job errors on 26 August and 1 October 2026; zero rows have ever been stored with that status; 2 payments carry an invoice reason with no match row. |
| REC-02 | Medium | The reference pass downgrades closed payments to no receipt required, against the file's own comment. | REC:300 against REC:24-28; guard only at REC:426. **Live:** 11 completed payments downgraded, last on 27 May 2026. |
| REC-05 | Medium | Reconciliation overwrites a hand-entered vendor and labels the source `rule` with no rule. | REC:300-329 |
| REC-06 | Medium | A payment quoting several invoice numbers is processed once per invoice, and each can use the whole bank amount. | REC:743-783 (review RV-08) |

**Change**

1. Migration: add `vendor_amount_matched` to the match status CHECK and `invoice` to both source CHECK constraints.
2. One RPC writes the match record, the payment update and the log row in a single transaction, guarded by 5.0. A forced failure at any step leaves nothing behind.
3. The reference pass honours `PAIRABLE_TRANSACTION_STATUSES`.
4. A payment quoting more than one invoice number is recorded as `multiple_invoice_refs` for a person to review. No invoice payment is recorded for it.
5. The export's invoice selector includes `vendor_amount_matched`.
6. A parity test: the TypeScript status union equals the values in the CHECK constraint.

The ledger write itself (recording the invoice payment) is made transactional and bounded in Release 6 (10.4).

### 5.3 Upload completion

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| FIL-01 | High | `performCompleteReceiptUpload` deletes the storage object at the path supplied by the browser before it has established that the path was issued to that user. Two simultaneous completions of one upload both see the open intent; the second insert hits the unique index and its error handler deletes the object the first call has just attached. A test asserts the deletion. | MUT:1192-1215, 1373, 1387, 1393, 1421-1431; `tests/actions/receipts.test.ts:766-820`; the race was reproduced by the reviewer with mocked storage. **Live:** no file row is currently missing its object. |

**Change** (review RV-01)

1. One RPC, `complete_receipt_upload`, locks the intent row, and in one transaction inserts the file row, updates the payment, writes the log and marks the intent complete with the file id.
2. A replayed call for a completed intent returns the stored file. It writes and removes nothing.
3. A storage object is removed only when no file row references its path and the caller holds the open intent for it. In every other case the error is returned and storage is left alone.
4. A storage removal that fails is recorded for the sweep in 10.1, not ignored.

**Tests:** simultaneous completions, a replay after a lost response, a forged path, and a failure after the object is stored each leave at most one attachment and never a file row without its object.

### 5.4 Rule creation guards

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| RUL-05 | High | A rule can be saved with only a direction, which would match every otherwise unmatched payment in that direction. | `src/lib/validation.ts:227-233`. **Live:** none exists. |
| RUL-06 | High | The default outcome of a new rule is "Mark as not required", so a rule meant only to name a vendor stops receipts being chased. | RULES:732; BULK:147, 185; MUT:1658; `validation.ts:224`; table default. **Live:** 72 of 180 active rules close payments as no receipt required. |

**Change:** require a keyword or a bank type. Change the default to "Leave pending" in all five places (migration for the table default). Any closing outcome must be chosen explicitly.

### 5.5 Audit trail

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| AUD-01 | High | Receipts audit entries record no user. | `src/services/audit.ts:45`; 16 of 17 `logAuditEvent` calls in ACT omit `user_id`. **Live:** 1,423 of 1,429 rows. |
| AUD-02 | High | Rule-applied log rows carry no user, and the retro-run audit entry is written by the browser from its own totals, only if the loop finishes. | MUT:508, 539; ACT:1231-1265. **Live:** 4,987 of 4,987 rule log rows have no user. |
| AUD-03 | Medium | The quarterly export and rule-driven mass classification write no audit entry. | Handled in 10.3 and 9.2. |

**Change** (W6, review RV-17): every receipts action passes the authenticated user's id and email to the audit service. Jobs record a named system actor and the user who started the work. Rule log rows record the triggering user. The retro-run audit entry is written on the server when a run starts and when it ends, from server totals. A failed audit insert is logged at error level, which is visible in production. A guard test asserts the actor on every receipts action. Historical anonymous rows stay as they are.

### 5.6 Smaller safety items

| ID | Severity | Finding and change | Evidence |
|---|---|---|---|
| WRK-01 | Medium | Saving a note rewrites who marked the payment and drops its rule link. Add `updateReceiptNote`, which touches only `notes`. **Live:** 32 note saves have done this. | MUT:915-925 |
| IMP-02 | High | The server returns `warning` and `skipped`; the toast shows neither. Show both. | MUT:726, 860, 864; `ReceiptUpload.tsx:47-52` |
| IMP-08 | Medium | A failed rules load reports "0 auto-matched"; a failed job enqueue is never reported. Return failure counts and show them. | MUT:281-321, 823-834 |
| AI-03 | Medium | The model's string "null" is accepted as a vendor name. Reject `null`, `unknown`, `n/a`, `none` and empty strings. **Live:** 5 pending proposals name the vendor "null". | OAI:484-495 |
| WRK-02 | Medium | The status tiles show zero and "All clear" when the count query fails. Show an error state. | QRY:164-165 |
| SEC-02 | Medium | `src/lib/openai/config.ts` is marked `'use server'` and exports a function that returns the API key. Remove the directive and confirm from the build output that no server action exposes it. | review RV-18 |

---

## 6. Release 2: import

### 6.1 Findings

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| IMP-01 | High | The batch row and the lines are written in two steps with no transaction, the repeat-file guard treats "batch exists" as "import finished", and the follow-up jobs are queued after the commit. An import that dies part-way cannot be retried, and a completed batch can hide missing rule, AI and reconciliation work. | MUT:718-740, 781-829 (review RV-02). **Live:** no orphaned batch since 2026; 26 empty batches remain from 2025. |
| IMP-03 | High | Records the parser cannot read are skipped and not counted. | HLP:214, 217, 223, 674, 677, 680; MUT:860 |
| IMP-04 | High | The date parser accepts impossible and ambiguous dates: `02/13/2026` becomes 2027-01-02, `31/02/2026` becomes 2026-03-03, `01/02/26` becomes 1926-02-01. | HLP:256-264. **Live:** no out-of-range date is stored. |
| IMP-14 | High | The amount parser accepts malformed money: `12abc` is read as 12 and `1,23` as 123. A wrong amount also becomes part of the payment's identity hash. | HLP:271-294; executed by the reviewer (RV-11) |
| IMP-05 | Medium | Two genuinely identical lines hash the same when the balance is blank or repeats, and the second is dropped silently. | HLP:364; MUT:783-786. **Live:** 30 same-day identical groups exist and survived; 98 of 136 Amex lines have no reference. |
| IMP-06 | Medium | An overlapping statement duplicates a line if the bank changes its type label, description case or running balance. | HLP:364 |
| IMP-07 | Medium | The repeat-file guard uses `maybeSingle()` and ignores the error, and the index on `source_hash` is not unique. | MUT:712-716. **Live:** 21 hashes are on more than one batch (all from 2025). |
| IMP-09 | Medium | The reconciliation job gets every new id in one unchunked `in` filter. | MUT:827-829; REC:126, 430 |
| IMP-10 | High | The import tests check copies of `fileSchema` and `parseCurrency`; nothing tests `performImportReceiptStatement`, the date parser, the bank hash or partial failure. | `tests/lib/receipts-import.test.ts:7-18, 68-80, 95-98` |
| IMP-11 | Medium | The historic import script has its own duplicate policy, is gated by `--apply`, hardcodes a path and an email, and force-completes every pre-2026 payment. | `scripts/receipts/import-historic-statements.ts:8-11, 41-55, 69, 139-141` |
| IMP-12 | Low | A missing `Date` column gives "No valid transactions found"; `.csv` is case-sensitive; encoding is assumed UTF-8; the 15 MB limit cannot be reached (about 4.5 MB platform limit); "last import" is shown in UTC; four direction helpers coexist. | HLP:89, 189, 200-207 |
| IMP-13 | Low | The Amex hash includes the description, but its comment and the Amex spec say it does not. | HLP:368-369, 388 |
| IMP-15 | High | A bank line with an empty `Details` column is dropped without a word. The bank's own charges arrive that way. Found during the build by running the old and new parsers over the 79 real statement files: the old parser kept 6,796 lines, the new one keeps 6,841 and rejects none. The 45 that were missing are 39 "Transaction Charges", 3 "Account Maintenance Fee", 1 cash withdrawal, 1 transfer and 1 "Satisfaction Guarantee". Every line the old parser kept gets the same identity from the new one. | HLP:214; build comparison, 1 October 2026 |

### 6.2 Design

1. **Record accounting.** A data record is one parsed CSV record after the header, excluding wholly blank records; a quoted multi-line field is one record. Both parsers return `{ rows, rejected }`, where each rejected item has the record number and a plain reason. `receipt_batches` gains `status`, `records_in_file`, `inserted_count`, `duplicate_count`, `rejected_count`, `rejected_records` (JSON), `repeated_in_file` and `followup_status`. The result panel shows the four numbers and lists rejected records (W8). A bank line with an empty `Details` column takes its description from `Transaction Type`, so the bank's own charges are kept (IMP-15); a line with neither is rejected.
2. **Dates** (W7). One function in `src/lib/dateUtils.ts`, validated by round trip. A bad date rejects the record, not the file.
3. **Money** (review RV-11). One strict grammar: optional `£`, digits with optional correctly placed thousands separators, optional decimal point with one or two digits; Amex also allows a leading minus. Anything else rejects the record. A record with both In and Out, or neither, is rejected. Zero stays distinct from blank.
4. **Atomic import with durable follow-up** (review RV-02). One RPC writes the batch, its lines and one `process_receipt_batch` job in the same transaction. That job runs rules for the batch, then queues AI classification, reconciliation and the duplicate refresh, each with a unique key so a retry cannot double them. The batch records `followup_status` as `queued`, `running`, `done` or `failed`, and the screen shows it. Rules always finish before the AI looks at the batch.
5. **Repeat-file guard without deleting anything** (review RV-12). `status` is `completed` or `superseded`. As built, `started` and `failed` are not needed: the batch and its lines are written in one transaction, so a batch that exists is a batch that finished. The migration marks the 26 empty legacy batches `superseded`, which leaves one completed batch per hash, then adds a unique index on `(source_type, source_hash)` where `status = 'completed'`; it stops with a clear error if two non-empty batches share a file. Re-uploading a completed file returns that batch, adds any line of the file that is not yet held (this is how the lines in IMP-15 are recovered, D14), and resumes any follow-up work that is not done. Two uploads of one file at the same moment are serialised by a lock on the file. A query error is a failed import, never a pass.
6. **Identical lines.** The first occurrence in a file keeps today's hash. The second and later get the hash with an occurrence number appended. The result panel says how many were kept this way.
7. **Messages.** Name the missing column. Accept `.CSV`. Decode Windows-1252 when the file is not valid UTF-8, and UTF-16 when it carries a byte order mark. The size limit is 4 MB, which is what a request can actually carry, and the screen says so. Show "last import" in London time. The outcome stays on screen until the next upload; a request that never comes back says so.
8. **Historic script.** Retire it. It has done its job, and its status rewrite must not run again.
9. **Tests.** The real exports, in London and UTC: malformed money, zero, refunds, both amount columns, rounding, quoted records, bad dates and exact accounting; and service tests for repeat file, interrupted follow-up, rejected records and identical lines.

**Not changed:** the hash formula for existing rows, the strict header names, the Bank or Amex toggle.

---

## 7. Release 3: vendors

### 7.1 Findings

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| VEN-01 | High | Vendor identity is the lower-cased name with whitespace collapsed and nothing more. Aliases are stored one per vendor, identical to the key, and never read. `merged_into_vendor_id` and the statuses `confirmed`, `merged` and `inactive` are never written by the app. There is no merge, rename or alias screen. | `src/services/receipts/vendorInsights.ts:28-32`; GOV:45-64, 87-95. **Live:** 235 of 262 vendors unconfirmed. Near-duplicates include Oak Farm Gas Co / Oak Farm Gas Co Ltd; Marks & Spencer / MARKS SPENCER PLC / M&S; Veolia with three; Jensten Insurance / Jensten Insurance Brokers; Spelthorne / Spelthorne Borough Council; Wix / Wix.com; TK Maxx / TKMaxx; PPL PRS / PPLPRS; HMRC with four; Sharon Morris Latham with three. |
| VEN-02 | Medium | Reports group vendors three ways and none uses `vendor_id`. | squashed baseline 14482-14530; `MIG/20260701000010:668-729`; QRY:1617-1619; EXP:288 |
| VEN-03 | Medium | A vendor is created as a side effect of any save with an unseen spelling. **Live:** 100 vendors have one payment and 16 have none. | GOV:34-101; QRY:331-339 |
| VEN-04 | Low | Watchlist and vendor reviews are keyed by vendor text with no foreign key. | `MIG/20260701000005`, `MIG/20260730000001` |
| VEN-05 | Low | **Live:** 6 payments differ in case from their canonical name; 19 payments have a name and no vendor id; 8 active rules name a vendor with no vendor id. | section 12 |
| VEN-06 | Low | The vendor month view applies `limit(1000)` before filtering by vendor. | QRY:1274-1289 |
| VEN-07 | Low | `default_expense_category` and `category_hint` are never set and never read. | Live |

### 7.2 Design

1. **Stronger matching key, for suggestions only.** A second key that also strips punctuation, company suffixes and web suffixes. It proposes merges and warns on creation. It never merges anything by itself.
2. **One resolver** (review RV-06). `resolveReceiptVendor` takes a name or an id and returns the active surviving vendor: it looks up the vendor key and the alias key, then follows `merged_into_vendor_id` to the end. Every writer uses it: manual edit, bulk apply, rules, invoice pairing, suggestion approval and the AI. The vendor id is authoritative; `vendor_name` on a payment is always the survivor's canonical name.
3. **Merge and rename**, super admin, each one RPC in one transaction:
   - `merge_receipt_vendor(from, into)` refuses a self-merge or a cycle. It moves `vendor_id` on payments, rules, rule suggestions and AI attempts; rewrites `vendor_name` on those payments and `set_vendor_name` on those rules; combines watch entries and reviews (W5); turns the old name and aliases into aliases of the survivor; sets the old vendor to `merged`.
   - `rename_receipt_vendor(id, name)` refuses a name whose key or alias belongs to another vendor. It updates the canonical name, the payments' `vendor_name` and the rules' `set_vendor_name`, and keeps the old name as an alias.
   - Both write an operation record in the same transaction holding the before values of every row touched (review RV-05). Undo restores only rows that still hold the applied value, reports the rest as conflicts, and is safe to repeat.
   - As built: a merge points any vendor merged earlier into the old one straight at the new survivor, so an old id always resolves in one step. Undo runs newest first: undoing a merge or rename is refused while a later merge or rename of the same vendor still stands, and that refusal changes nothing and can be tried again. Each payment a merge, rename or undo touches gets a history row. AI attempts are tied to vendors in Release 4, which adds them to the merge. The functions run as the caller and are granted to the service role only.
4. **Vendor management on `/receipts/vendors`.** A list with status, kind (business or person), payment count, total, last seen, and "possible duplicates". Actions: confirm, rename, merge, deactivate, set default category. A deactivated vendor keeps its history and is no longer offered.
5. **Creation is explicit for people.** The picker offers the vendors in use (not merged, not deactivated), in alphabetical order. "Create new vendor" shows similar existing names first. A manual save with an unseen spelling no longer creates a vendor silently: the payment row, the phone card, the bulk screen and both rule forms ask first, offering the existing vendors the name might be. As built, the order is alphabetical and not "most used first": a list of 250 names ordered by use cannot be scanned, and counting use would add a heavy query to every load of the workspace. Automatic writers still create a vendor when they meet a new name (a rule that names one, invoice pairing, the AI in Release 4), and record where it came from.
6. **One source for reports.** A view gives each payment its surviving vendor id and canonical name; trends, movements, the vendor month view and the missing-category summary use it. Watchlist and reviews gain `vendor_id` with a foreign key. Totals before and after must match: checked on live data on 1 October 2026, every vendor's total is identical under the old functions and the new view (3,447 payments, 248 vendors, £763,580.04 out, £827,080.09 in). The vendor month view no longer reads a capped slice of the month (VEN-06). The export keeps reading the name on the payment, which is now always the vendor's own name; its rewrite is in Release 6.
7. `default_expense_category` is used (8.2 item 4). `category_hint` is left alone.

---

## 8. Release 4: AI classification and vendor naming

### 8.1 Findings

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| AI-01 | High | The AI's work does not reach the payment. Proposals go only to a rules queue that is hidden on phones, needs super admin to act on, and shows no count outside the rules card. | AIC:247-249; RULES:486, 493. **Live:** 68 pending, none ever actioned; 44 of 218 payments imported on 1 October have no vendor. |
| AI-02 | High | A proposal's keyword is never checked against the payment text, and punctuation is stripped so `amazon.co.uk` becomes `amazoncouk`. | HLP:472-491; OAI:230 against 402-407. **Live:** 27 of 68 keywords are absent from every evidence payment; 17 match nothing; 10 match more than 50 (`range` 1,423; `paypal` 1,352; `anchor` 889). |
| AI-06 | High | The prompt does not include the vendor list, so the model invents a spelling each time. | OAI:349-410. **Live:** "BFS Group" and "BFS Group Ltd"; "Jacob William" beside the existing "Jacob Williams". |
| AI-04 | High | A non-OK response, an empty reply or bad JSON returns null and the job finishes as completed. Retry never fires. There is no request timeout and `finish_reason` is not checked. A missing API key returns silently. | OAI:235, 426, 463-481; AIC:148-151, 229-245; `src/lib/retry.ts:117-134` |
| AI-08 | High | "Re-classify Untagged" re-sends every payment with no vendor or no category, every time. **Live:** 5,177 payments qualify, about 518 jobs per click. | MUT:2007-2031, 631-634 |
| AI-09 | High | The bulk page makes one model call per group during page load and stores an accepted guess as `manual`. **Live:** 2,293 such calls. | QRY:95-156, 511-513; `MIG/20260708000020:67, 71` |
| AI-10 | High | Bank descriptions go to OpenAI, including staff names on wage payments. The examples, the same-description hints and (once added) the vendor list are further channels for the same names. | AIC:61-132, 158 (review RV-07) |
| AI-18 | High | The queue worker awaits every non-SMS job before it starts SMS jobs, so a slow classification can delay real messages. A timed-out handler is not cancelled and can overlap its retry. | `src/lib/unified-job-queue.ts:75-97, 660-702` (review RV-09) |
| AI-05 | Medium | Proposals duplicate, and declined ones return. **Live:** 10 keywords appear on more than one pending proposal. | AIC:292-340; GOV:374 |
| AI-07 | Medium | A result with no confidence passes the 70 floor. | AIC:279 |
| AI-12 | Medium | Where a vendor is already set, the proposal carries only a category; approving it either never applies or displaces the older rule. | AIC:284-285; MUT:360-367 |
| AI-13 | Medium | The approval list hides the category when a vendor is present and its match count uses a different matcher. | RULES:592; GOV:344-357 |
| AI-15 | Medium | The category list lives in five places with no parity test. | `src/lib/validation.ts:164-189`; `src/types/database.ts:126-150`; `src/lib/pnl/constants.ts:33` |
| AI-16 | Medium | Wage payments to a new member of staff stay unclassified until someone writes a rule naming them. **Live:** 39 payroll rules, 20 seeded in migrations. | `MIG/20260701000012`, `...13`, `MIG/20260801001400` |
| AI-11 | Low | The cost tile shows US dollars as pounds and includes recruitment spend. | OAI:12-17 |
| AI-17 | Low | 200 payments carry a legacy AI vendor and 153 a legacy AI category; 20 were written below 70 confidence. | Live |

### 8.2 Design

1. **One attempt record per payment** (review RV-14). New table `receipt_ai_attempts`: `transaction_id`, `prompt_version`, `outcome` (`vendor_written`, `category_proposed`, `nothing_identified`, `low_confidence`, `skipped_protected`, `payroll_local`, `failed_retryable`, `failed_final`), `vendor_id`, `proposed_expense_category`, `proposed_no_category`, `category_state` (`proposed`, `accepted`, `edited`, `dismissed`, `superseded`, `none`), `confidence`, `reasoning`, `model`, `error`, timestamps and the reviewing user. One row per payment and prompt version. A payment is sent again only when it has no attempt for the current prompt version, or its last attempt was `failed_retryable`. "Re-classify" follows the same rule, which removes AI-08.
2. **The prompt carries the vendor list.** Active business vendors with their aliases. Vendors of kind `person` are never sent. The schema is strict: the model returns a `vendor_id` from the list, or `new_vendor_name` when it identifies a real vendor not on the list, or neither when it cannot tell. `confidence` is required, and a missing one is treated as below the floor of 70. Placeholder strings are rejected.
3. **The vendor is written to the payment** (O3). The job writes vendor id, name and source `ai` when, at the moment of writing, the payment has no vendor and no vendor source (5.0). A new vendor name is resolved through 7.2 item 2; if its matching key equals an existing vendor's, that vendor is used; otherwise an unconfirmed vendor is created, flagged as created by AI, and shown at the top of the vendor list for confirming. Rules still outrank the AI: a later rule may replace an `ai` vendor.
4. **The category is proposed, not written** (W1). The payment shows "Suggested category (confidence)" with Accept, Edit and Dismiss on desktop and mobile. Accepting writes it with source `ai_accepted`, in one statement that also checks the payment has not changed and closes the proposal. "No category applies" (O8) is a valid proposal and a valid manual choice: it is stored as `expense_category` empty with `no_category_applies = true` and a source. Rules may set it too. Payments so marked leave the "needs category" views and are not sent to the AI again. Where the vendor has a default category set by a person, that is the category proposed, in place of the model's guess. Grouped by vendor, "Accept all" accepts every open proposal in the group and respects the lock date.
5. **Every input channel is filtered** (review RV-07). Before any model call: payments recognised as wages (item 7) are removed; examples and same-description hints are dropped when their vendor is a person or their category is Total Staff; the vendor list excludes people. A test captures the outgoing request and asserts no employee name appears.
6. **Failures are visible.** A non-OK response throws so the queue retries; 429 and 5xx back off; requests abort after 30 seconds; a truncated reply is a failure; 401 and a missing key are final and shown. The workspace shows "N payments could not be classified" with a retry control.
7. **Wage payments** (O4, W2). Money-out lines are matched on the server against employee names, current and former, together with the payroll reference pattern taken from the existing payroll rules. An exact match on both sets the vendor to that person (a vendor of kind `person`), the category to Total Staff and the status to no receipt required, with source `rule` and the attempt outcome `payroll_local`. A name match without the reference, two employees with one name, or a reference without a name is left pending and flagged "possible wage payment, check". Nothing about these lines goes to OpenAI. Existing payroll rules keep working. No payroll rule is added by migration again.
8. **Rule proposals, checked.** A rule proposal is raised only when two or more payments with the same vendor share a literal, word-bounded piece of description text. The keyword must appear in every evidence payment, may be a phrase, and must not match payments carrying a different vendor: the collision count is shown and blocks approval when above zero. Duplicates are judged on the full match-and-action identity (keyword, direction, amount limits, type, vendor, category, outcome), covering pending, approved and declined proposals and active and inactive rules. Existing duplicates are left alone. A declined proposal stays declined (W9). Where a rule already matches the same text, the proposal is "add this category to the existing rule", which depends on 9.2 item 6. Approval stays super admin. The approver sees every field, sample text and counts from the real matcher, and can edit first.
9. **Queue manners** (review RV-09). SMS jobs in a claimed batch run before receipts jobs. Receipts jobs get their own timeout below the route's, pass an abort signal to the model call, and stop claiming when the route's remaining time is short. Writes are safe to repeat after a lost lease (they are guarded by 5.0). Classification jobs carry a unique key per chunk. No other job type's timeout changes.
10. **Bulk page.** Reads stored attempts. No model call on page load.
11. **Housekeeping.** One category list exported from one module, with a parity test against both CHECK constraints and the P&L map. The cost tile shows US dollars for receipts contexts only.

**Tests, with no model calls:** the real batch classifier with a mocked `fetch` for non-OK, truncation, id mismatch, invented vendor id, duplicate entries and missing confidence; the write guard when a rule or a person sets the vendor during the call; acceptance retry and edit-during-proposal; wage fixtures for former employee, abbreviated payee, same name and reimbursement; the request capture in item 5; mixed SMS and receipts batches.

**As built (1 October 2026)**

- Build order: this release was built after Release 5 and applies after it. Its migration replaces three functions Release 5 created, so that a rule run can also set and restore "no category applies".
- The attempt record has one more outcome than item 1 lists: `payroll_check`, for a line that may be a wage payment and needs a person (item 7). It also keeps `tries`. A payment whose call keeps failing is given up on after five tries (`failed_final`) and is sent again only when someone presses "Try again".
- The lock date applies to the AI. A payment on or before it is not sent, and "Accept all" leaves it alone. Accepting one suggestion by hand is a person's own edit and is not blocked, the same as any other manual change.
- The vendor is written through the same guarded database function the rules use (`apply_receipt_rule_change`): only if the payment is unchanged since it was read, and together with its history row. If the payment changed while the model was answering and still has no vendor, the write is tried once more on the payment as it now is. If a rule or a person has set the vendor in the meantime, nothing is written.
- A single accept, change or dismiss is one database function (`decide_receipt_ai_category`), under a lock on the payment. If a rule or a person has categorised the payment first, the suggestion is closed and the payment is left alone. A change is stored with source `manual`, an accept with `ai_accepted`. Choosing a category from the ordinary picker while a suggestion is open answers the suggestion: the same category is an accept and a different one is a change.
- "Accept all" is a recorded run of kind `ai_accept_all`, the same record a rule run makes. It writes each payment only if it is unchanged, shows under Recent runs and can be undone there; undoing it opens the suggestions again. It lives on the bulk page, as "Suggested categories", grouped by vendor.
- A suggestion is shown only while the payment has no category. One whose payment has since been categorised is hidden straight away and closed the next time it is touched.
- "No category applies" is on payments and rules, with a database check that it never sits beside a category. It is offered in the category picker on the list and the phone card, and in both rule forms. Bulk apply by group does not offer it yet: that screen is rebuilt in Release 6 (10.4), where it is added.
- Wage payments (W2): an exact match is one member of staff's full name (first or preferred name, and surname) plus the payroll reference, on money out. The reference is the `payroll_reference` setting and defaults to "the anchor", which is what the 2026 payroll rules match on. Titles, case, accents and apostrophes are ignored. Anything less certain is held as `payroll_check` with a note that does not repeat the name: a name without the reference, a name that fits two people, an initial and surname with the reference, or the reference with no known name. A payment a person has already closed keeps its status. The vendor is created as kind `person`, origin `payroll`.
- What is kept out of the request (item 5), each covered by the request-capture test: wage and possible-wage lines; vendors of kind `person`; any vendor or alias whose name is a member of staff's, whatever kind it was given; examples whose text or vendor names a member of staff, whose vendor is a person, or whose category is Total Staff. A vendor name the model returns that is a member of staff's is not created. Same-description hints are no longer sent at all.
- Rule proposals (item 8) are raised by a job after a classification run that wrote a vendor, at most 25 a run, once a day. Evidence is payments whose vendor a person or the AI set and no rule sets. The keyword is the longest run of whole words every evidence payment contains; words that only say how a payment was made ("card purchase", "direct debit") are not enough. Where a vendor's payments share no single text they are split by leading word, so a vendor that trades under two names gets two proposals. A proposal carries a category only when two or more people-set categories agree. Payments naming a member of staff, and vendors who are people, take no part.
- The match and clash counts are stored when a proposal is raised and worked out again, with the matcher in use, when the proposals panel opens and at the moment of approval. Approval is refused on the server when the keyword also matches another vendor's payments, or when an identical rule exists (on or off); the panel disables the button and offers "Edit first", which fills the new rule form.
- "Add this category to the existing rule" is approved by its own database function (`approve_receipt_rule_category_suggestion`), which refuses if the rule has been switched off or has gained a different category.
- Queue (item 9): receipts jobs run last in a claimed batch and have a 45 second timeout, against the route's 60. If fewer than 47 seconds of the run remain they are handed back unstarted, and the wait is not counted as an attempt. The classification job passes a cancel signal to the model call. Classification jobs are queued at priority -10 with a key per chunk.
- Cost tile (item 11): a new function `get_receipt_ai_usage` counts the receipts contexts only and the tile shows US dollars. On 1 October 2026 receipts spend to date is about US$0.27; the old tile's figure included about US$0.37 of recruitment spend. The dashboard's app-wide figure is unchanged.
- Category and source lists (item 11): the code list stays in `src/lib/validation.ts`. A guard test reads the last definition of each CHECK constraint from the migrations and fails if the code list, either constraint or the P&L map differ.
- The old per-payment and per-group model calls are removed from `src/lib/openai.ts`. The bulk page reads stored suggestions and makes no call (item 10).
- Not verified: no model call has been made from this build. The classifier is tested with the network stubbed, and no screen of this release has been opened in a browser.

---

## 9. Release 5: rules management

### 9.1 Findings

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| RUL-10 | High | There is no exact preview, no undo and no lock for filed periods. The preview exists only on the New Rule form, returns counts not rows, and ignores locks, precedence and scope. | QRY:1688-1789; RULES:747-755, 907-951 |
| RUL-07 | Medium | A retro run loads only the target rule, so it takes payments a higher-priority rule owns. | MUT:263-265, 323 |
| RUL-08 | Medium | The refresh after approving or enabling a rule reads 500 pending payments in no order. | MUT:664-668 |
| RUL-11 | Medium | Keywords of four or more characters match inside other words. **Live:** no false match found among existing rules. | RM:46 |
| RUL-12 | Medium | One rule sets everything. **Live:** 29 active rules set a vendor and no category. | MUT:360-367 |
| RUL-13 | Medium | Errors are swallowed; logs and signals are written after the change and their failure is ignored, so a change can have no history to undo from. | MUT:476-490, 500-572; ACT:1216 (review RV-05) |
| RUL-14 | Medium | No duplicate check at create or approve. | MUT:1730-1765 |
| RUL-15 | Medium | A rule made from a bulk group uses the whole description; commas become separate keywords. The bulk form offers "Can't find" as an outcome. | BULK:36-42, 145; RM:92 |
| RUL-16 | Medium | The screen shows no match count, last matched date or never-matched flag, has no test box and is hidden on phones. **Live:** 71 of 180 active rules have matched nothing dated 2026; 6 have never matched. | RULES:164, 483, 486, 887-903 |
| RUL-17 | Medium | 54 rule upserts live in migrations, 20 naming staff. | `MIG/20260701000012`, `...13`, `MIG/20260801001400` |
| RUL-18 | Low | Conflict reporting flags every overlap and does not name the other rule. **Live:** one open conflict. | GOV:140-157, 188-290 |
| RUL-19 | Low | The "reviewed" stamp survives material edits. Two parsers handle one form. `kind` drives nothing. | MUT:1646-1662, 1717-1720 |
| RUL-20 | Low | Applying a proposal to the New Rule form writes the keyword to the DOM, not to state. Needs a browser check. | RULES:299-302, 717 |
| RUL-21 | Low | Dead code: `hardDeleteReceiptRule`, `runReceiptRuleRetroactively`. | ACT:816, 1267-1383 |

### 9.2 Design

1. **Preview bound to the run** (review RV-04). `evaluateRuleImpact(rule, scope)` returns the exact payments a rule would change with before and after values, following 5.0, precedence, scope and the lock date. Confirming a run stores the preview: the rule's version, the lock date, and each payment id with its `updated_at`. The run applies only that set. A payment that changed is skipped and counted. If the rule or the lock date changed, the run stops and asks for a new preview. The preview is available on create and on edit.
2. **Runs are recorded and reversible** (review RV-05). `receipt_rule_runs` holds the rule, scope, user, times and counts. Each change is applied by an RPC that writes the payment update and its before-image (vendor, category, their sources and rule ids, status and marking fields) in one transaction, so a change without history cannot exist. "Undo run" restores only payments still holding the applied values, reports the rest as conflicts, and is safe to repeat. Bulk apply (10.4) and "accept all" (8.2 item 4) use the same record.
3. **Lock date** (O6, W4). `receipts_locked_before` in settings, set by super admins. Every writer named in W4 skips payments dated on or before it and reports how many.
4. **Rule health.** Matches all time, in the last 90 days, last matched date, and "shadowed by". Filters for active, kind, outcome, stale and never matched.
5. **Test box.** Paste a bank description, see which rule wins each field and why.
6. **Matching.** Per-field output (W3): status from the winning rule; vendor and category from the best matching rule that sets each; the payment's existing `vendor_rule_id` and `expense_rule_id` record which. Single-word keywords match on word boundaries at any length, and phrases collapse whitespace: before this ships, a shadow comparison lists every payment whose winner would change under the new matcher, for review; nothing is rewritten automatically. Commas from a bulk group are escaped. The refresh pages through all pending payments in id order. A retro run evaluates every active rule and applies only where the target wins a field.
7. **Guards.** Duplicate check on create and approve using the full identity in 8.2 item 8. "Can't find" is removed as a rule outcome. Failed updates are counted and reported.
8. **Screen.** Split RULES into proposals, rule form, rule list and run dialog. Add the description input. Clear the reviewed stamp on any change to keywords or outcome. One of "Disable" and "Deactivate". One action at a time. A read-only list on phones.
9. **Conflicts.** List only pairs with the same priority and different outputs, name both rules, refresh after approval.
10. **No more rules in migrations.**

**As built (1 October 2026)**

- Build order: this release was built before Release 4, which needs its per-field output, run records and lock date.
- The preview is stored as a run (`receipt_rule_runs`, `receipt_rule_run_changes`) holding the rule's version, the version of the whole rule set and the lock date. Applying it stops if the rule, any other rule or the lock date has changed. Only the person who made the preview can apply it. A run is applied and undone 200 changes at a time.
- Every rule change, in a run or not, is written by one database function together with its history rows (`apply_receipt_rule_change`, `apply_receipt_rule_run`), so a change without history cannot exist (RUL-13). Runs do not also write classification signals: nothing reads that table, and the run record is the trace.
- The lock date lives in a new `receipt_settings` table that only the service role can touch, not in `system_settings`, which any manager can write through its row policies. The database functions enforce the lock as well as the application.
- Rule outcomes are limited to "leave pending" and "no receipt required". This removes "can't find" (item 7) and also covers the part of O2 that says a rule can no longer mark a payment completed. Live rules use only those two outcomes already.
- Per-field output (W3) is on. Run over the live data it changes nothing today: no payment has a lower rule supplying a vendor or category the best rule leaves unset.
- Whole-word matching is built and is OFF. The comparison on live data (8,420 payments, 180 active rules): it would change 6 payments, and in every case a correct match would be lost ("Booker" no longer matching "Bookers", "Wickes" no longer matching "WICKESBUILD", "Jensten Insurance" no longer matching "JENSTENINSURANCE"). It would remove no wrong match. The recommendation is to leave it off. A super admin can see the comparison and switch it on the rules screen.
- Rule health is worked out by running the matcher over every payment when asked. On live data: no rule has never matched, none is always beaten by another, and 105 of 180 have matched nothing in the last 90 days (D12).
- Conflicts now list only pairs with the same priority and a different result, and name the other rule.
- A rule made from a bulk group keeps the whole description as one keyword: commas in it are escaped.
- Screen: the run dialog, the rule tools (lock date, recent runs with undo, test box, health, matcher comparison) and the phone list are their own components; there is one on/off control; one action at a time; a description field on both forms. The proposals panel is split out with Release 4, which rewrites it.

---

## 10. Release 6: files, export, workspace and invoices

### 10.1 Receipt files

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| FIL-02 | High | The file hash is stored and never compared, so attaching one document to two payments raises no warning. This is the 15 September 2026 incident. | MUT:1200-1201, 1290. **Live:** 8 hashes are shared across payments, all legitimate. |
| FIL-04 | Medium | Nothing sweeps abandoned uploads, and a failed delete can leave a completed payment with no file. | MUT:1526-1541, 1587-1590. **Live:** 2 objects with no file row and 2 open intents, both from 18 August 2026. |
| FIL-05 | Low | A failed "view" is silent; the hint about expiring links is wrong; saved files end in a timestamp; HEIC is accepted and not converted; a hash failure is ignored; declared size and type are stored unverified. | `ReceiptTableRow.tsx:177-180, 393`; QRY:562-564; MUT:1397-1419 |

**Design** (review RV-15, RV-16)

1. **Duplicate warning before anything is written.** Completing an upload first hashes the stored object. If the bytes cannot be read, the upload is rejected. If the hash is already on another payment, the call returns a typed warning naming those payments and writes nothing. Confirming re-uses the same intent and hash and re-checks. Cancelling removes the object. Files attached from invoices are exempt, because one invoice legitimately serves several payments. Shared files are marked in the list and in the export.
2. **Sweep**, daily: remove objects and intents for uploads abandoned more than 24 hours ago, never an object referenced by a file row; report objects with no row and completed payments with neither file nor reason.
3. **HEIC.** Convert in the browser on a canvas, as the maintenance tracker does (`src/lib/maintenance/photo-normalise.ts`), because the server image library cannot decode iPhone HEIC. If the browser cannot decode the file, say so plainly. The hash is of the stored bytes.
4. Take size from the stored object. Show an error when a view fails. Give the download a proper file name.

### 10.2 Status

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| FIL-03 | High | A payment can be completed with no file and no reason. **Live:** 119 completed payments from 2026 have no file, 57 of them money out, all marked by hand. | MUT:915-925 |
| WRK-09 | Medium | `receipt_required` is derived and read by nothing. The per-payment log is never shown. | MUT:917 |

**Design** (O2): the rule is "completed means a file, or a written reason" and it applies to every writer. Completing by hand without a file requires a reason, stored as `completed_reason`. Deleting the last file reopens the payment unless a reason is recorded. Rules can no longer set `completed`. Existing completed payments without a file are listed for review (D7); they are not changed automatically. The CSV gains `Has receipt`, `Receipt files` and `Completed reason`. A tile counts "completed without receipt". Each payment gets a history popover from the log. `receipt_required` stays as a derived compatibility field.

### 10.3 Export

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| EXP-01 | High, latent | The quarter is read in one unpaged query. The same is true of the expenses CSV and expense images. **Live:** largest quarter is 394. | EXP:73-79; `expenses-csv.ts:45-50`; `expense-images.ts:43-48` |
| EXP-02 | High | A file that fails to download is skipped with a console warning. A failed expense-file query looks like zero files. The export writes no audit entry. | EXP:140-143 |
| EXP-03 | Medium | Every file and the whole ZIP are held in memory. **Live:** Q3 2026 is 69 files and 12 MB. | EXP:116-119, 145-148, 212 |
| EXP-04 | Low | Formula escaping checks only the first character; the helper is copied three times; an error shows raw JSON; stamps are UTC; the OJ invoice paid-at boundary uses UTC midnight, not London. | EXP:28-34, 251; `oj-project-invoices.ts:197-202` |

**Design** (review RV-10)

1. **One manifest.** The export first reads the ids and values it will ship, paged on a unique order, then builds the CSV and fetches files from that manifest. Before finishing it re-reads the ids; if the set changed, it fails with "the quarter changed while exporting, try again". The manifest is written into the pack as `MANIFEST.csv`.
2. **Failures are explicit.** A missing or unreadable file is listed in `MISSING_FILES.txt` in the pack. A failed metadata query for any component fails the pack. Mileage failure stays fatal.
3. **Audit.** One entry when the pack is built, with user, quarter and the manifest counts, including missing files.
4. **London boundaries** for every timestamp comparison. Transaction dates stay dates.
5. One shared CSV helper that also handles leading tab, carriage return and whitespace. A guard test for unbounded reads of the payment and file tables. The ZIP stays buffered: at 12 MB a quarter there is no present need to stream, and buffering lets the response report a failure.

### 10.4 Workspace, bulk and the invoice ledger

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| WRK-03 | Medium | A failed status change makes the row vanish. | `ReceiptsClient.tsx:138` |
| WRK-04 | Medium | Sorting puts empty amounts first and has no final `id`. | QRY:257-269 |
| WRK-05 | Medium | The Needs Vendor and Needs Expense tabs show pending payments only. | `UI/page.tsx:45-46` |
| WRK-06 | Medium | The default view loads 1,000 rows, renders them twice and refetches about eight queries on every change. | QRY:239-242, 345-347; `ReceiptList.tsx:174, 221` |
| WRK-07 | Medium | Fuzzy groups are built on a normalised description, but Apply matches the exact description and reports success for zero rows. Apply also reaches payments already classified by hand, with no undo. | `MIG/20260701000013:466-469`; `MIG/20260708000020:44-47, 63-74` |
| WRK-08 | Low | Search covers description and type only; group totals are per page; a bad `page` value crashes the page; the mobile card lacks several things the table has; several controls have no label. | QRY:299; `receipt-list-groups.ts:30-60` |
| REC-03 | Medium | An invoice payment is recorded, and a later failure before the match row is written means a retry could record it again. | REC:781-804 |
| REC-04 | Medium | The set of already-claimed invoices is read unpaged and returns empty on error. | REC:545-554 |

**Design:** restore from a snapshot on failure. Sort with nulls last and a final `id`. Tabs show every status and leave out payments marked "no category applies". Render one layout; page at 100 with server-side grouping and totals; one shared dialog. Bulk apply sends the group's payment ids, follows 5.0, says "N will change, M decided by a person will not", and records a run (9.2 item 2). Search covers vendor, notes and amount. One RPC records the invoice payment, the match and the receipt update under a lock on the bank payment, and refuses to allocate more than the payment's amount in total (review RV-08). The claimed-invoice read is paged and fails closed.

### 10.5 Housekeeping

| ID | Item |
|---|---|
| SEC-01 | Six receipt tables still grant table privileges to `anon` and `authenticated` (row security blocks them). Four invoker functions are executable by `anon`. `get_receipt_detail_groups` has two overloads. Revoke and tidy. |
| SEC-03 | A view-only user can trigger OpenAI calls through the vendor cost review and AI summary actions. Move both to `receipts.manage`. |
| DEAD-01 | Remove unused code: `POST /api/receipts/upload` and `uploadReceiptForTransaction`, `getMonthlyReceiptSummary`, `getAIUsageBreakdown`, `buildReceiptName`, `src/lib/receipts/direction.ts`, three constants at `types.ts:502-504`. Code only, no data. Tables and columns are not dropped. |
| DEAD-02 | `receipt_anomalies` and `receipt_duplicate_reviews` are unused; the duplicate-candidate view is refreshed on every import and shown nowhere. Left in place (section 13). |
| CODE-01 | Split MUT, QRY and ACT along their natural seams as each release touches them. Share the row and card handlers in one hook. |
| TEST-01 | Merge the three overlapping action test files as they are touched. |
| TEXT-01 | Notes use a long dash as the timestamp separator. New notes use a plain separator; the parser still reads old notes. |

### 10.6 Invoices attached automatically (O9)

**Today.** When a bank payment is matched to an invoice, the payment is marked "no receipt required" and a match record is stored. The invoice itself is not attached: the accountant has to find it separately, and the payment carries no evidence. **Live:** 25 payments tie to a real invoice and none has it attached.

**Design**

1. `receipt_files` gains `source` (`upload` or `invoice`, default `upload`) and `invoice_id`. One invoice can be attached to a payment once (unique on payment and invoice).
2. After a match that names a real invoice is stored (`matched`, `payment_recorded`, `already_paid`, `amount_mismatch`, `vendor_amount_matched`), a job `attach_invoice_to_receipt`, keyed on payment and invoice, renders the invoice PDF with the existing generator, stores it in the receipts bucket and adds the file row. It then marks the payment completed (W12) through the same guarded write as 5.0. If rendering or storage fails, the job retries; the payment stays "no receipt required" with the invoice number as its reason, which is a valid state under O2.
3. A payment split across several invoices gets each one. An invoice paid by several payments is attached to each of them. These files are exempt from the duplicate warning.
4. The attached PDF is a copy taken when the match is made. "Refresh invoice copy" on the file re-renders it, for when the invoice is later changed.
5. The same job runs for existing matches that have no invoice attached, so the 25 current payments are covered the first time reconciliation runs after release. This is a change to live data that follows directly from O9.
6. In the list the file shows as "Invoice INV-..." and opens like any other receipt. The export ships it under `receipts/` with the payment, and the manifest names it.
7. Deleting an attached invoice copy is allowed and reopens nothing by itself: the payment returns to "no receipt required" with its invoice reason.

**Tests:** job idempotency, render failure, split payment, shared invoice, refresh, delete, and the export listing.

### 10.7 As built (1 October 2026)

**Files (10.1)**

- The duplicate check is inside `complete_receipt_upload`, under a lock on the file's hash, so two uploads of the same file at the same moment cannot both pass unwarned. The warning lists up to ten of the other transactions and says how many there are. "Attach anyway" finishes the same upload without sending the file again; "Do not attach" removes the stored file.
- The server reads the stored bytes back before attaching. It records their size and what they are (from the first bytes, not from what the browser declared), refuses a file it cannot read, and refuses an iPhone HEIC that arrived unconverted. The browser converts HEIC to JPEG first (longest edge 3000px, so small print stays readable) and says what to do when it cannot.
- Removing a file is one database function (`delete_receipt_file`): the file row, the transaction's status and its history move together, and the stored object is removed afterwards. A completed transaction that loses its last file goes back to pending, or to "no receipt required" if it is matched to a real invoice, unless it has a reason.
- The sweep runs daily at 03:50 UTC (`/api/cron/receipts-sweep`). It removes uploads abandoned for more than a day, only after the database has released them. It reports, and never removes, stored files that nothing refers to and completed transactions with neither a file nor a reason. It answers 500 if a file could not be removed, so the cron alert fires.
- A file that sits on other transactions is marked "Also on N others" in the list and in `MANIFEST.csv`. A file link that cannot be made shows an error. Download uses the file's own name.

**Status (10.2)**

- Completing by hand is one database function (`mark_receipt_transaction`), which refuses "completed" without a file or a reason. The screen asks for the reason first. The reason shows under the status, in the export and in the audit entry. Notes are not touched by a status change.
- The count of completed transactions with no file and no reason is a tile and an alert with a "Review Them" link (`/receipts?noReceipt=1`), and a filter. Nothing is changed automatically (D7).
- Each transaction has a History button: what happened, when (London time), who, and how the status moved.

**Export (10.3)**

- Built from one manifest read in pages. Every file is in the pack or named in `MISSING_FILES.txt`; `MANIFEST.csv` lists every file and whether it is in the pack. The quarter is read again before the pack is finished, and a change is refused with a 409 and "The quarter changed while the pack was being built. Please try again."
- The Export button fetches the pack, so a refusal shows as a message, not a page of JSON, and a pack with missing files says so when it arrives.
- One audit entry per pack: who, which quarter, and the counts.
- The expenses CSV and expense images are read in pages; a failed read of the expense files now fails the pack.
- Not done: the ZIP is still buffered in memory (EXP-03), as the design says.

**Workspace, bulk and ledger (10.4)**

- One layout is drawn: the table from 1024px, cards below it. Every view pages at 100. Grouped by vendor, each vendor is kept together across pages and its heading shows the total of the whole group, worked out on the server.
- A status change the server refuses puts the transaction back exactly as it was and where it was. While testing this a second fault was found and fixed: a successful change moved the summary tiles twice.
- Search covers description, type, vendor, note and an amount. A page number that is not a number is page one.
- Bulk apply sends the group's own transactions. It first reports what would change ("N will change, M decided by a person will not"), then applies as a recorded run that can be undone from Recent runs. It never changes a status, leaves locked transactions alone, and writes the source as manual.
- A change from the spec: on the bulk page an empty vendor box, or "Leave unset" as the category, now means "leave it as it is". Both boxes start ticked for a group that needs them, and an empty one used to be sent as "clear it" on every transaction in the group. Clearing in bulk is no longer offered on that page.
- The invoice payment, the match row and the transaction update are one database function (`record_receipt_invoice_payment`), which refuses to allocate more than the bank payment in total; an over-allocation is stored as "review required". Both invoice-matching reads are paged, and a failed read stops the run.
- Not done (WRK-06, in part): a change still refreshes the page's server queries. The row itself updates at once, so this costs time on the server and not on the screen.

**Housekeeping (10.5)**

- SEC-01: table privileges revoked from `anon` and `authenticated` on the six receipt tables; five reporting functions limited to the service role; the unused three-argument `get_receipt_detail_groups` dropped. SEC-03: both OpenAI-backed vendor actions need `receipts.manage`.
- DEAD-01 done, plus `queryMonthlyReceiptSummary`, which nothing called.
- CODE-01 in part: bulk apply, invoice copies and the sweep are their own files, and the row and card share one hook. The mutation and query files are smaller and still large.
- TEST-01: three action test files became two, with one new file for the Release 6 actions.
- TEXT-01: new notes use " | "; old notes are still read.
- A guard test fails on any read of the payment or file tables that has no bound. Writing it found one more unpaged read in invoice matching, now paged.

**Invoices (10.6)**

- As designed. The copy is rendered by the invoices section's own PDF generator and stored at `<year>/invoice_<number>_<transaction>_<time>.pdf`, a shape an upload can never be issued, so one cannot be passed off as the other.
- The job queue renders one invoice per run and hands the rest back for the next run without counting an attempt: the generator starts a headless browser.
- A transaction on or before the lock date gets no copy from the job. "Refresh invoice copy" is a person's own action and is allowed on a locked transaction, like any single manual edit (W4); it changes the file and not the status.
- The 25 existing matches are picked up by the first reconciliation run after release, at most 200 per run.

---

## 11. Rollout and testing

### 11.1 Order and compatibility

1. Release 1 first, alone.
2. Releases 2, 3, 5 and 6 can follow in any order. Release 4 needs Releases 1 and 3 and the per-field rule output from Release 5 (9.2 item 6), which is therefore built with Release 4 if Release 5 has not shipped. Bulk undo (10.4) and the lock on "accept all" need the run record and lock date from Release 5; until then they ship without undo and without the lock.
3. Every migration is additive: new tables, new nullable or defaulted columns, new functions, wider CHECK lists. Nothing is dropped or deleted. The code currently deployed keeps working against the new schema, so a migration may be applied before its code. New code reads new columns, so its migration is always applied first.
4. In this repository a committed migration can be applied by any session's `db push`. Each migration is therefore safe to apply on its own at any time.
5. Rolling the application back does not undo invoice ledger entries, deleted objects or merged vendors. New source values (`invoice`, `ai_accepted`) written by new code are accepted by the old code's reads; the old rule engine treats them as it treats `import` for vendor and as unlocked for category, so a rollback after Release 1 must be followed by a forward fix, not left running.
6. Old queued jobs keep their payload shape. New job types are added beside them.

### 11.2 Migrations

| Release | Migration contents |
|---|---|
| 1 | Add `vendor_amount_matched` to the match status CHECK; add `invoice` to both source CHECK constraints; change the default of `receipt_rules.auto_status` to `pending`; RPCs `complete_receipt_upload` and `apply_receipt_invoice_match` |
| 2 | Batch status and count columns with the legacy backfill; unique index on completed batches; RPC for the atomic import and its follow-up job |
| 3 | Vendor kind and origin columns; operation record table; merge, rename and undo RPCs; `vendor_id` on watchlist and reviews; vendor view |
| 4 | `receipt_ai_attempts`; `ai_accepted` in both source CHECK constraints; `no_category_applies` on payments and rules; accept RPC; category-suggestion approval RPC; receipts-only AI cost function; the Release 5 field functions replaced to carry `no_category_applies`. Applies after 5 |
| 5 | `receipt_rule_runs` and before-image table; guarded apply and undo RPCs; lock-date setting |
| 6 | `completed_reason`; file `source` and `invoice_id`; the upload function replaced to check for duplicates; delete, mark, ledger and invoice-attach RPCs; the invoice match function replaced to respect the lock date; grant revocations; one unused function overload dropped. The sweep's cron entry is in `vercel.json`, not the migration. Applies last |

Every SECURITY DEFINER function states its `search_path` and grants. Each migration is validated by running it and its RPCs against production inside a transaction that is rolled back, which executes every statement and persists nothing, then applied through the `prod-migrate` workflow with the owner's go-ahead. After any migration that adds a table, view or SECURITY DEFINER routine, run `scripts/security/assert-anon-surface.ts`.

### 11.3 Tests and acceptance

- Run on the supported runtime (Node 20) in both time zones: `npm test` and `npm run test:utc`, with lint, both typechecks and a cold build.
- Tests call the real function, not a copy and not a mock of the thing under test.
- New RPCs are exercised against a real Postgres inside a rolled-back transaction with synthetic rows: success, each forced failure, replay and concurrent claim where the lock matters.
- Guard tests: audit actor on every receipts action; category list parity; match-status parity; source list parity; unbounded reads of the payment and file tables.
- Permission matrix: each new action is called as viewer, manager and super admin and the denied cases are asserted.
- Changed screens keep labelled controls, focus return on dialog close, and distinct loading, empty and error states.
- A release is called done only after its path is run on the deployed build under the right role and the outcome and deployment id are quoted. Mutating checks against production are run only with the owner's agreement.

---

## 12. Data corrections

| # | What | Size | State |
|---|---|---|---|
| D1 | NEST payments: vendor "NEST Pension", category Total Staff, and the rule changed to match. | 11 payments, £193.09, 1 rule | Approved 1 October 2026 (O7). Applied with the owner's go-ahead at release. |
| D2 | Expire the 68 pending AI rule proposals once Release 4 is live. | 68 rows | Needs a yes |
| D3 | Merge near-duplicate vendors, pair by pair. | about 25 pairs | Needs a yes per pair, through the Release 3 screen |
| D4 | Fix case differences between a payment's vendor name and its vendor. | 6 payments | Needs a yes |
| D5 | Link payments that have a vendor name and no vendor id; give vendor ids to rules that lack one. | 19 payments, 8 rules | Needs a yes |
| D6 | Empty legacy batches. No longer deleted: Release 2 marks them superseded. | 26 batches | Covered by the Release 2 migration |
| D7 | Review completed 2026 payments that have no receipt. | 119 (57 money out) | For the owner, through the Release 6 tile |
| D8 | Remove two abandoned uploads from 18 August 2026. | 2 objects, 2 intents | Covered by the Release 6 sweep |
| D9 | The "Uber" rule also catches Uber Eats and files it under Travel/Car. | 1 payment | Needs a yes |
| D10 | Review legacy AI classifications from before June 2026, starting with those under 70 confidence. | 200 vendor, 153 category | For the owner |
| D11 | Resolve the open rule conflict between "Mr Fizz" and "Oak Farm Gas". | 7 payments | For the owner |
| D12 | Review the 71 active rules that have matched nothing dated 2026, and the 6 that never matched. | 77 rules | For the owner, through Release 5 rule health |
| D13 | Attach invoices to the payments already matched. | 25 payments | Follows from O9; happens through 10.6 item 5 |
| D14 | Recover the bank lines the old import dropped (IMP-15): upload the historic statement files again once Release 2 is live. Each upload adds only the lines not yet held. Then add a rule for "Transaction Charges" and "Account Maintenance Fee" so they are filed as bank charges. | 45 lines in the 79 files checked | Needs a yes. The owner uploads the files; nothing is done automatically |

---

## 13. Not in this build

1. Reading receipt documents (total, date, VAT).
2. New categories, a `capital_movement` kind, and any use of rule `kind` in reports.
3. A duplicate-payment review screen.
4. Anomaly detection and the diagnostics planned in the earlier v2 design.
5. Flexible bank column names.
6. Rethinking the Amex identity hash.
7. How the P&L should treat payments with no category.
8. A reminder for outstanding receipts.
9. Rule editing on a phone.
10. Changing the shared audit service or the job queue for the rest of the app.
11. Streaming the export.
12. Dropping any table or column.

---

## 14. What was not verified

- No application build or deployed journey has been run for this spec. Findings marked Code are traces. RUL-01, REC-01, AUD-01, AI-01, AI-02 and FIL-03 are confirmed by production data. FIL-01 and IMP-14 were executed by the reviewer with mocks and the real parser.
- RUL-20 and the browser behaviours in 10.1 and 10.4 need a browser check.
- The live bodies of database functions were compared with migrations by name and signature, and in part by body.
- No sample of the bank's CSV is in the repository. The money grammar in 6.2 item 3 is confirmed against real files before Release 2 is called done.
- The production deployment was not matched to a commit.
- After the build (1 October 2026): every migration ran on a throwaway Postgres 15 and none has been applied to production. No screen has been opened in a browser. No call has been made to OpenAI from this build. The invoice copy job has not been run in the serverless environment, where the PDF generator starts a headless browser. The filter for completed transactions without a receipt relies on PostgREST filtering on an empty embedded relation, which the tests stand in for and do not exercise.

---

## 15. Review findings map

| Review | Subject | Handled in |
|---|---|---|
| RV-01 | Atomic upload finalisation; never delete a referenced object | 5.3, 10.1 item 2 |
| RV-02 | Follow-up work committed with the import | 6.2 items 4 and 5 |
| RV-03 | Field protection for every source and deliberate blanks | 5.0, 8.2 item 4 |
| RV-04 | Protection checked at the write; preview bound to the run | 5.0, 5.1, 9.2 item 1 |
| RV-05 | Complete atomic operation record for undo | 7.2 item 3, 9.2 item 2 |
| RV-06 | Vendor identity survives every writer | 7.2 items 2 and 3 |
| RV-07 | Payroll filtering across the whole AI payload | 8.2 items 2, 5 and 7 |
| RV-08 | Invoice provenance atomic; allocation bounded | 5.2, 10.4 |
| RV-09 | Shared queue must not delay SMS | 8.2 item 9 |
| RV-10 | Export manifest and consumer parity | 5.2 item 5, 10.3 |
| RV-11 | Strict money and defined record boundaries | 6.2 items 1 and 3 |
| RV-12 | Release dependencies and rollback | 1.2, 6.2 item 5, 11.1, 11.2 |
| RV-13 | Per-field rule output and duplicate identity | W3, 8.2 item 8, 9.2 items 6 and 7 |
| RV-14 | AI lifecycle | 8.2 items 1 to 4, O3, W1, W2 |
| RV-15 | Completed reasons, file warnings and cleanup as one lifecycle | 10.1, 10.2 |
| RV-16 | HEIC decoding and London time boundaries | 10.1 item 3, 10.3 item 4, W7 |
| RV-17 | Audit attribution and scope | 5.5, W6 |
| RV-18 | Release-specific proof, permission matrix, secret exposure | 11.3, 5.6 (SEC-02) |
| RV-19 | Baseline measures (optional) | Not built. The Release 4 failure count and Release 6 tiles give the first figures. |
| Factual | VEN-01 wording; "all closed again" | Corrected in 4.3, 5.1 and 7.1 |

---

## Appendix A. Queries a reviewer can re-run (read-only)

```sql
-- Closed payments moved by rule runs (RUL-01)
select previous_status, new_status, count(*), max(performed_at)::date
from receipt_transaction_logs
where action_type in ('rule_auto_mark','rule_classification')
  and previous_status is distinct from 'pending'
  and new_status is distinct from previous_status
group by 1, 2;

-- Audit entries with no user (AUD-01)
select count(*) filter (where user_id is null), count(*)
from audit_logs where resource_type ilike 'receipt%';

-- Reconciliation job errors (REC-01)
select created_at::date, attempts, error_message
from jobs where type = 'reconcile_receipt_invoice_payments' and coalesce(error_message, '') <> '';

-- AI proposals whose keyword is not in their own evidence (AI-02)
select count(*) from receipt_rule_suggestions s
where status = 'pending' and not exists (
  select 1 from receipt_transactions t
  where t.id = any(s.evidence_transaction_ids)
    and t.details ilike '%' || s.match_description || '%');

-- File hashes shared across payments (FIL-02)
select content_hash, count(distinct transaction_id)
from receipt_files group by 1 having count(distinct transaction_id) > 1;

-- Completed 2026 payments with no file (FIL-03)
select count(*) from receipt_transactions t
where status = 'completed' and transaction_date >= '2026-01-01'
  and not exists (select 1 from receipt_files f where f.transaction_id = t.id);

-- Payments matched to an invoice, and how many have a file (O9)
select count(distinct m.receipt_transaction_id),
       count(distinct m.receipt_transaction_id) filter (
         where exists (select 1 from receipt_files f where f.transaction_id = m.receipt_transaction_id))
from receipt_invoice_matches m where m.invoice_id is not null;
```

---

## Appendix B. Earlier findings that are still open, and where this spec handles them

| Earlier ID | Item | Handled in |
|---|---|---|
| DEF-008, FF-013 | AI enqueue failure not surfaced | 5.6 (IMP-08), 6.2 item 4 |
| DEF-010 (residual) | Failed-job banner counts all time and cannot clear | 8.2 item 6 |
| DEF-012 | Orphaned storage file leaves no record | 5.3 item 4, 10.1 item 2 |
| DEF-019 | Fuzzy group shown, exact match applied | 10.4 (WRK-07) |
| DEF-020 | Direction helpers: now four | 6.1 (IMP-12), 10.5 (DEAD-01) |
| DEF-025 | Link-expiry hint | 10.1 item 4 |
| EXT-004 | No timeout on OpenAI requests | 8.2 item 6 |
| Business rules flag 3 | Reopen leaves files on a pending payment | 10.2 |
| Business rules 10.10, Mapper 8 | Re-queue batch tagging; duplicate jobs | 8.2 items 1 and 9 |
| Architect | Refresh of pending capped at 500 | 9.2 item 6 |
| Architect, Mapper 6 | One model call per group on bulk page load | 8.2 item 10 |
| Mapper 4 | Missing API key: job silently completes | 8.2 item 6 |
| Mapper 10, 13 | Export and rule mass classification not audited | 10.3, 5.5 |
| QA gap 7 | Two simultaneous imports of one file | 6.2 item 5 |
| FF-002 | Amex hash comment contradicts the code | 6.1 (IMP-13): comment corrected |
| FF-018 | No tests for stored `source_type` | 6.2 item 9 |
| CR-FF-05 | Ranking cannot tell "no type required" from "type unknown" | 9.2 item 6 |
| CR-FF-07, 16 | Blank keyword allowed | 5.4 |
| CR-FF-09 | One-keyword cap picks a poor token | 8.2 item 8 |
| v2 design section 4 | Super-admin permanent delete unreachable | 9.1 (RUL-21): removed |
| v2 design section 5 | Reports do not use canonical vendor ids | 7.2 item 6 |
| v2 design section 7 | File duplicate detection | 10.1 |
| Rework spec | Proposal count on the workspace | 8.2 items 4 and 6 |
| 12 September doc | No description input; reviewed stamp never clears | 9.2 item 8 |
| 14 August review | Row and card duplicate handlers; rules panel desktop only | 10.5 (CODE-01), 9.2 item 8 |
| Amex plan task 18 | Bank payments to Amex counted twice in P&L | Checked live: those payments carry no category, so the P&L does not count them. No change. |
