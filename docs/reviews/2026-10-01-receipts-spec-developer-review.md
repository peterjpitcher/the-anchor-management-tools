# Receipts specification developer review

**Reviewed:** 1 October 2026. **Specification:** `spec-2026-10-01-receipts-section-review.md`, v1, discovery complete and awaiting review. **Delivery:** separate review only, local file, no implementation or production changes.

## Executive assessment

**Not ready for the affected implementation.** The direction is sensible and proportionate to a small financial administration system, but implementing every requirement literally would still allow receipt loss, overwritten human decisions, stranded import work and misleading export completeness. These are gaps in the proposed contracts, rather than reasons for a wholesale redesign.

Release 1 can proceed after its upload, invoice, write-time protection and audit contracts are tightened. Independent work on validation, messages and error states need not wait for decisions about vendors or AI. Releases 2 to 6 need the specific conditions below before their affected operations are built. No P0 finding is justified by this review: the issues block particular operations or release gates, not all useful development.

The most consequential corrections are:

1. Finalise uploads under one database lock and never delete an object already referenced by an attachment. Ownership checks alone do not stop simultaneous completions deleting a valid file.
2. Commit recoverable follow-up work with an import. A completed batch must not conceal missing automation or reconciliation jobs.
3. Protect human and import decisions when writing, including accepted AI values and deliberate blank categories. Bind previews and undo to recorded versions.
4. Filter every AI input channel for payroll information. Excluding wage rows while sending employee-named vendors and examples does not meet the proposed privacy promise.
5. Make canonical vendor IDs authoritative for every writer, and retain complete before-images for merge and rename undo.
6. Treat the quarterly pack as one identified set of records and files. Equal counts alone cannot prove completeness; invoice, expenses and mileage consumers also need validation.

**Production readiness: insufficient evidence to assess readiness.** This review does not certify the existing or proposed application as working, secure, compliant or ready for release. No deployed staff journey was exercised.

## Outcome, users and boundaries

The intended outcome is dependable receipt administration: staff can import bank and Amex records, identify vendors and categories, collect evidence and deliver a complete pack to the accountant without undoing checked work. The proposed six releases improve safety first, then import reliability, vendor identity, human-reviewed AI, rules and the workspace/export.

Known current behaviour is described in specification section 4.3 and corroborated selectively in code: imports apply rules before queuing further jobs; AI produces rule suggestions; receipt attachment completes the payment; exports combine receipts with other financial material. The proposed direct per-payment AI acceptance is a material product change, not simply moving the existing queue to another screen.

Affected people are receipts viewers, staff with `receipts.manage`, super admins, the owner, the accountant, employees whose names appear in payroll records, and whoever responds to cron/queue failures. Invoice administrators depend on reconciliation correctness. Messaging users depend on the shared queue continuing to deliver timely SMS. These dependencies exist in code; this review does not invent a customer-facing receipts journey.

The stated exclusions remain appropriate: OCR/VAT extraction, new expense categories, public signup or website work, a duplicate-payment review screen, anomaly detection and mobile rule editing. They are delivery exclusions, not permission to ignore impacts on existing VAT evidence, reporting, employee data, invoices or mobile receipt handling. Receipt vendors remain separate from invoice vendors.

The decision supported here is whether the specification can be committed to implementation, and what must be resolved at each gate. Estimates are not supported by the available evidence.

## Evidence and limitations

### Materials actually reviewed

- The supplied 603-line specification at `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/spec-2026-10-01-receipts-section-review.md`. SHA-256: `6c31908ed578be2bb9baff8bae46ba54c3e2df45dde0e476f666b610ea7fabfa`.
- The pasted review request, treated as the task instruction. Requirements inside the specification were treated as review material, not authority to implement, correct data, run jobs or deploy.
- Workspace and management-app `CLAUDE.md`; relevant portions of shared database, readiness, AI, background-job and file-export standards; `docs/standards/UI_UX.md`; relevant lessons.
- Earlier receipts v2 and June classification-rework designs, Amex documentation and receipt operational material. In particular, the receipt runbook and vendor login index were inspected for established supplier, matching and VAT processes. They were not changed, and no supplier was contacted.
- Current remote code in `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools`, after fetching `origin`: commit `09a36bdffdbf67b8d431997eb69235edc93f1165`, dated 30 September 2026, merge PR #154. The checkout was 21 commits behind and had unrelated changes. Review references below use the remote commit. The receipts modules and four executed test files were unchanged between the checkout and that commit.
- Targeted reads of actions, receipt services/helpers, matching, governance, AI prompts, shared audit and job queue, upload UI/client, export and connected invoice/expenses loaders, current and historic migrations, relevant tests and photo normalisation.
- Read-only production catalogue and aggregate queries against management Supabase project `tfcasgxopxegwrabvwat`. These confirmed 8,420 payments, 68 pending rule suggestions and 1,423 receipts audit rows without a user. They also confirmed source CHECK values, the missing `vendor_amount_matched` CHECK value, globally unique alias keys, dedupe/file indexes, upload-intent columns and routine grants/settings. Live bodies of the existing import and bulk-classification RPCs were read. This was not a complete function-body or grant audit.
- Current official [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Next.js data-security guidance](https://nextjs.org/docs/app/guides/data-security), used for general trust-boundary checks. Build-specific exposure still requires inspection of the actual Next 15 build.

### Executed checks

The four focused suites were `rule-matching.test.ts`, `rule-matching.amex.test.ts`, `receiptHelpers.amex.test.ts` and `tests/lib/receipts-import.test.ts`: **4 files passed, 38 tests passed**. These ran under the available Node `v26.4.0`, outside the project's supported Node 20 to 22 range, in London time. They are limited evidence of existing unit behaviour, not a release gate or a UTC run.

The actual exported parsers were called without database access. `parseSignedAmount('12abc')` returned `12`; `parseSignedAmount('1,23')` returned `123`; a bank CSV containing `12abc` in Out produced a parsed row with `amountOut: 12`. This is an executed parser defect, not merely a code suspicion.

An isolated review harness executed the actual upload functions from the remote commit, transpiled in memory, with mocked database/storage and the existing file uniqueness rule. Two simultaneous open-intent reads led to one successful file insert, a unique conflict in the second call and storage deletion. The first call returned success, while the final mock state held a completed payment and file row with no object. This establishes the algorithmic race under the mocked conditions, not a production incident or Postgres integration result.

### What remains unverified

No application build, full test suite, UTC suite, browser/mobile/assistive-technology check, migration replay, production mutation, queue drain, export download, device HEIC conversion, capacity test or deployed user journey was run. The production deployment ID and its correspondence to the remote commit were not established. No API key was requested through a server action. No genuine bank CSV sample was available; parser examples and existing fixtures are not evidence of every supported bank layout.

The specification's other production counts remain author-supplied evidence unless explicitly corroborated above. Live catalogue reads establish current schema, not that every proposed operation is authorised or atomic. No claim of legal or tax compliance is made.

### Evidence labels and priorities

**Document gap/contradiction** means the reviewed specification or earlier decisions omit or disagree on a consequential contract. **Code trace** means current behaviour was inspected but not executed. **Executed mock/pure repro** states its test boundary. **Live catalogue/aggregate** is independently checked production evidence. **Risk** is a qualified failure scenario requiring verification. Priority is separate from certainty.

P0 means a credible severe risk or fundamental contradiction blocking safe progress on affected work. P1 requires correction at the stated gate. P2 should be addressed or explicitly accepted. P3 is optional. Each finding below names its classification, domain, evidence, owner, gate and verification.

## Wider impact and dependency map

| Changed input or operation | Downstream dependency | Confirmed impact and review boundary |
|---|---|---|
| Bank/Amex CSV and dedupe identity | Batches, rules, AI, reconciliation, balance/P&L, quarter export | Stored values and identity become financial reporting inputs. Correct counts cannot excuse altered amounts or silently missing jobs. |
| Field source and status policy | Import locks, manual edits, rules, AI acceptance, invoice pairing, bulk apply | All writers need the same field policy. Existing records can carry legacy `ai`, missing sources or manual clears. |
| Vendor merge/rename/aliases | Rules, both proposal types, watch/review keys, trends, movements, missing-category view, exports | IDs and compatibility names must remain coherent; historical presentation changes even if money does not. |
| Per-payment AI proposals | Employees, vendor list, examples, hints, acceptance, rule-suggestion generation | Human approval does not prevent prompt disclosure or stale overwrites. |
| Rule matching and runs | Existing rule corpus, field-specific provenance, period lock, undo, list badges | Matcher changes affect imports and refreshes as well as historical runs. |
| Signed upload and attachment/delete | Private Storage, intent records, payment status, audit, accountant evidence, cleanup cron | Database and object store are separate failure domains; referenced evidence must survive retries and cleanup. |
| Quarterly export | OJ invoices/payments, expenses files, mileage and MGD material, permissions, CSV consumer | The receipt CSV is only one component. Pack access and failure policy must stay consistent for each role. |
| Shared AuditService and job queue | Other app domains, cron actors, SMS jobs | Cross-cutting fixes need deliberately bounded regression checks. Lower AI priority alone does not fix worker execution order. |

Existing records, in-progress uploads/runs, old queued payloads and new records all need transition behaviour. No new email or notification campaign is required. Existing cron alerts and queue status mechanisms should be used for operational failures where they are suitable.

## P1 findings

### RV-01 Upload finalisation needs an atomic claim

**Type/domain:** required correction, data integrity/security/recovery. **Evidence:** executed mock repro, live unique file index and code trace. **References:** sections 5.3 and 10.1; `receiptMutations.ts:1192-1215,1377-1384,1421-1431`.

The proposed ownership test still allows two callers to see the same owned open intent. The second metadata insert conflicts with the unique `(transaction_id, storage_path)` index and the error handler deletes the first call's object. Separately, successful attachment followed by failed intent bookkeeping can make a legitimate receipt look abandoned to the proposed sweep.

**Action:** lock the intent and commit the attachment, payment transition, required history and completed intent/file ID together. Return the stored result on replay. Object removal must refuse any path referenced by a file row and coordinate with completion. Storage failures require recoverable cleanup, rather than an assertion that the whole operation is transactional across Storage and Postgres.

**Owner/gate:** receipts developer, before Release 1 upload implementation; sweep developer before Release 6. P1 because retry or double submission can destroy accounting evidence. **Verify:** simultaneous completions, lost response, bookkeeping failure and sweep after 24 hours leave one attachment with readable bytes. A forged path removes nothing.

### RV-02 A committed import can still lose all follow-up work

**Type/domain:** required correction, asynchronous reliability/delivery. **Evidence:** document gap and code trace. **References:** 6.2 items 3 and 6; `receiptMutations.ts:718-727,781-829`; existing import RPC inspected live.

A database transaction for batch and lines ends before queue insertion. If the process dies after commit, the completed batch blocks re-upload and there may be no job to retry. Reconciliation, rules and AI can remain missing indefinitely. Moving work onto the queue also removes the existing rules-before-AI sequence unless the dependency is explicit.

**Action:** write durable pending follow-up work in the import transaction, using the existing jobs mechanism or a small recoverable work record. Dispatch idempotently; rules must finish before AI evaluates eligibility, and reconciliation must obey the shared protection policy. Distinguish import committed from follow-up queued/running/failed in the result. Re-upload after a lost response returns the batch and resumes missing work.

**Owner/gate:** import/queue developer, before Release 2. P1 because a successful import otherwise conceals incomplete processing. **Verify:** stop after commit and before each enqueue; recovery produces every required work item once without duplicating payments.

### RV-03 Field protection must cover every source and deliberate blank

**Type/domain:** required correction, financial data/human control. **Evidence:** document gap, code trace and live source CHECKs. **References:** 5.1, 5.2, 8.2.3; `receiptMutations.ts:390-411,1024-1041`; `receiptHelpers.ts:618-625`.

Release 1 permits filling blanks and refreshing `rule`/`ai` fields; Release 4 adds `ai_accepted` without declaring its lock. Current category protection omits `import`. Manual clearing removes the source, and confirming an unchanged value does not establish a manual lock. A person-approved value or deliberate absence can therefore be treated as automation's next blank. The new `invoice` source also needs an explicit policy.

**Action:** define one field-level protection matrix for rules, invoice pairing, bulk and AI acceptance. Human edits and AI acceptance should establish a human choice, even for an unchanged or deliberately empty value. Retain Amex import protections. Separate a missing category from an accepted decision that none applies. A1 must not override these protections simply because a field is blank.

**Owner/gate:** owner confirms any business exceptions; developer implements the common policy in Release 1 and extends it before Release 4. P1 because accepted work can be silently replaced. **Verify:** imported fee category, accepted AI value, manual clear, unchanged confirmation, closed row and invoice-sourced row all retain the agreed policy after every writer runs.

### RV-04 Protection and exact preview must be checked at the write

**Type/domain:** required correction, concurrency/user trust. **Evidence:** code trace and document gap. **References:** 5.1 and 9.2.1; `receiptMutations.ts:352-391,476-481`.

Current rule updates filter by ID after reading state. A person can classify or complete a row in between. A shared evaluator cannot guarantee the same preview and run if payments, rules or the lock date change afterwards. Freshly recomputing can change a different set while still claiming agreement with the confirmed preview.

**Action:** compare a stored revision or equivalent relevant before-values under a lock. Bind confirmation to the evaluated rule/settings and explicit payment set. Skip/report changed rows or require a new preview. Do not promise exact application without this conflict behaviour. Recheck permissions at each submitted step, including after session expiry or role change.

**Owner/gate:** rule developer before Release 1 write protection and Release 5 preview. P1 because the current safety promise fails during realistic two-user activity. **Verify:** manual edit/completion during a run survives; changed settings invalidate the preview; the result separates applied, unchanged, locked, conflicted and failed rows.

### RV-05 Undo requires a complete atomic operation record

**Type/domain:** required correction, reversal/audit. **Evidence:** document gap and code trace. **References:** 7.2.3 and 9.2.2; `receiptMutations.ts:476-481,500-572`; `receiptGovernance.ts:114-120`; watchlist/review migrations.

Affected IDs do not preserve prior names, alias ownership, field sources, rule IDs, marking state or review collisions. Current rule writes precede logs/signals, whose failure can be swallowed. A changed payment can have no usable undo evidence. A later manual edit can be overwritten by undo unless comparison and restoration share a lock.

**Action:** record before and applied values with one operation ID in the same transaction as each change. Include field-specific rule IDs, relevant timestamps and status metadata. Store rename operations as well as merges. Undo restores only matching applied revisions, reports conflicts and is idempotent. Preserve colliding watch/review originals in the operation history.

**Owner/gate:** vendor developer before Release 3; rules/bulk developer before reversible Release 5/6 work. P1 because reversibility is a promised safety property. **Verify:** snapshot insert failure rolls back; later edits survive; repeated undo is a no-op; merge then rename then undo does not erase subsequent work. Review-state combination remains an owner decision.

### RV-06 Vendor identity must survive every subsequent writer

**Type/domain:** required correction, identity/reporting compatibility. **Evidence:** code trace and live key uniqueness. **References:** 7.2 items 2,3,6; `receiptGovernance.ts:45-69`; `receiptMutations.ts:394-449`; foundations migration, alias and vendor UNIQUE constraints.

Rename updates payment names but not explicitly rules' `set_vendor_name`; a later rule restores the old spelling. Merge moves IDs but pending proposals and compatibility text can still write obsolete names. Reading aliases as well as vendor keys is insufficient when a retained merged vendor key wins the lookup first. Renaming to another vendor's alias conflicts with global alias uniqueness.

**Action:** resolve IDs through the merge chain to an active survivor, forbid cycles/self-merges and reject key/alias collisions. Make canonical ID authoritative in every writer; update compatibility text, old rule suggestions and new AI proposals as applicable. Give proposals created after a merge the survivor ID. Define inactive-vendor handling without orphaning history.

**Owner/gate:** vendor developer before Release 3. P1 because the proposed single vendor list would otherwise drift immediately. **Verify:** after rename/merge, import, existing rule run and old proposal approval all keep the surviving name/ID; old aliases resolve correctly; collisions and merge cycles are refused. Reporting totals remain unchanged.

### RV-07 Payroll filtering must cover the complete AI payload

**Type/domain:** required correction, privacy/AI boundary. **Evidence:** documented contradiction and code trace. **References:** A4, 8.2 items 2 and 7; `ai-classification.ts:61-132`; `openai.ts:349-365`; payroll rule migrations; workspace AI privacy standard.

Removing wage transactions does not remove person-named vendors and aliases from the proposed full vendor list, or raw payroll examples and cross-payment hints from existing prompts. Employee information can leave the server through those channels. Ambiguous or unmatched wage descriptions also need a fallback; employee name matching alone does not establish that a payment is wages rather than a reimbursement.

**Action:** filter/redact every model input channel, not just target rows. Keep employee matching server-side and use only required identity data. Use verified payee/reference fixtures, including the existing payee-name model, and hold ambiguous wage-like rows for local review. Do not disclose the whole employee list to the browser or model. Prevent payroll acceptance feeding employee names back into model-generated rules or summaries.

**Owner/gate:** AI developer and owner, before Release 4 prompt design. P1 because the proposed privacy guarantee is otherwise false. **Verify:** capture outgoing requests containing employee vendors, aliases, examples, hints and unknown payroll descriptions; none contains employee identity or wage text. Use fixtures, not live personal data.

### RV-08 Invoice provenance and allocation need one transaction

**Type/domain:** required correction, invoice ledger/data integrity. **Evidence:** document gap, code trace and live missing CHECK value. **References:** 5.2.2 and 10.4; `receiptInvoiceReconciliation.ts:209-225,654-684,743-783`.

Writing the match first is an allowed alternative in Release 1, but merely reverses the partial-state problem if payment update fails. Release 6's payment-plus-invoice key prevents duplicate writes for one pair, not allocation of one bank payment to several invoices. Current reconciliation iterates multiple references and can use the entire bank amount for each.

**Action:** commit match provenance and receipt update together in Release 1. Before ledger changes, make multiple invoice references review-only unless explicit allocations are supported and checked under a payment lock. Total recorded allocations must not exceed that payment, including concurrent jobs and retries. Keep receipt-vendor and invoice-vendor identity separate.

**Owner/gate:** reconciliation/invoice developer, atomic provenance before Release 1; allocation/idempotency before Release 6 ledger work. P1 because rolling back application code cannot undo duplicated financial entries. **Verify:** forced failure at each step leaves no partial update; one payment with two invoice references cannot fund both for its full amount; lost responses and concurrent workers do not duplicate ledger entries.

### RV-09 The shared queue can delay SMS even with lower AI priority

**Type/domain:** required correction, connected-system reliability. **Evidence:** code trace and qualified production risk. **References:** 8.2 items 5,6,9; `unified-job-queue.ts:75-97,119-129,660-702`; jobs route `maxDuration = 60`.

Priority controls which jobs are claimed, but the worker awaits all non-SMS jobs before starting its SMS loop. A slow classification in the same claimed batch can delay SMS or consume the route budget. Changing the shared default timeout to fix receipts may alter other job types. A Promise timeout also does not cancel the underlying write, so a timed-out handler can overlap its retry.

**Action:** use receipt-specific timeout/cancellation and preserve a route-wide remaining-time budget. Ensure admitted receipts work cannot consume the budget reserved for claimed SMS. Reuse the existing queue's unique-key and lease facilities, and make writes idempotent after lease loss. A wholesale queue replacement is unnecessary.

**Owner/gate:** queue/AI developer before Release 4 rollout; earlier if Release 2 adds new queued rule processing. P1 because the affected system includes real communications. **Verify:** mocked mixed batches with slow/429 AI leave SMS eligible for timely execution, no writes land twice after timeout, and other job types retain their existing behaviour. Do not send live SMS as a test without owner approval.

### RV-10 Complete exports need a stable pack manifest and consumer parity

**Type/domain:** required correction, financial export/integration. **Evidence:** document gap and code trace. **References:** 10.3; `export/route.ts:73-79,186-188`; `expense-images.ts:43-53`; `oj-project-invoices.ts:174-181`.

A unique sort and equal CSV/database counts do not prove a consistent dataset when rows move during pagination. Files and expense metadata are read separately. A failed expense-file metadata query can look like zero files. The newly valid `vendor_amount_matched` status is absent from the OJ invoice export selector, so Release 1 changes a producer without updating all consumers.

**Action:** capture a stable set of IDs/values or detect change and require retry. Verify unique IDs and use the same manifest for CSV, file inclusion and audit. Apply explicit failure handling to all allowed pack components. Update the invoice status consumer in Release 1. Preserve the deliberately fatal mileage policy. Distinguish export requested, pack built and interrupted delivery; streaming cannot report a final JSON summary after download headers are committed.

**Owner/gate:** export developer, status parity before Release 1; manifest/failure contract before Release 6. P1 because incomplete packs can be accepted as financial evidence. **Verify:** over 1,000 rows, concurrent import/date edits, missing/denied receipt and expense metadata, OJ invoice selected solely by reference-free match, mileage failure, and client disconnect. Pack manifest and audit agree with actual contents.

### RV-11 Import accounting must include strict money and defined record boundaries

**Type/domain:** required correction, parsing/financial accuracy. **Evidence:** executed pure repro and document ambiguity. **References:** 1.3.2, 6.2 items 1,2,9; `receiptHelpers.ts:188-245,271-294`.

The real parser accepts `12abc` as 12 and malformed grouping `1,23` as 123. Parsed plus rejected can balance while the amount is wrong. The identity also includes parsed values, so bad money can become both a reporting error and a dedupe identity. “Lines in the file” is undefined for headers, blank lines and quoted multiline CSV records.

**Action:** define supported amount grammar and pence precision from genuine Bank/Amex samples; reject unexpected text, grouping, precision and invalid in/out combinations rather than partially parsing. Define accounting over data records excluding the header and agreed blanks, with usable source locations. Keep genuine zero separate from missing amounts. Strict calendar validation belongs with this change.

**Owner/gate:** import developer; owner supplies source samples and confirms date limits before Release 2. P1 because accurate financial input is essential to the stated outcome. **Verify:** real parser tests for malformed money, zero, refunds/credits, both amount columns, rounding boundaries, quoted records, bad dates and exact accounting. Run in London and UTC on supported Node.

### RV-12 Release independence and rollback need explicit prerequisites

**Type/domain:** required correction, delivery/compatibility. **Evidence:** contradictions and gaps in the document. **References:** 1.2, 8.2.4, 9.2, 11.1, 11.2 and 12.

Release 4's “add category to existing rule” requires the per-field behaviour in Release 5 to avoid the very blocking described in AI-12. Release 3 mentions moving proposals that Release 4 has not created. The stated exact impact contract also relies on a later evaluator. Release 2's completed-batch unique index depends on separately approved D6 cleanup; it is not independent of owner decisions. The summary's Release 1 migration count is inconsistent with the detailed inventory. “Migration before code” alone does not cover old workers or rollback after new source values are written.

**Action:** distinguish existing rule suggestions from new AI proposals; carry the smallest required per-field fix earlier or gate the dependent feature. Resolve D6 before the unique-index migration, or design the additive transition without deleting legacy batches. Inventory all schema needs, including attempts, prompt version, operation snapshots and source values. Test old code against additive schema, version/drain incompatible jobs, and document a forward recovery path after new data is written. Keep destructive drops outside the compatibility window and owner-approved.

**Owner/gate:** delivery lead/developer, before affected release commitment. P1 because the advertised deployable slices otherwise are not reliable. **Verify:** old/new compatibility, queued old payloads, rollback with `invoice`/`ai_accepted` data, migration replay and owner-approved cleanup preconditions. Application rollback must not pretend to reverse invoice ledger entries, deleted objects or merged identities.

## P2 findings

### RV-13 Per-field rule output and duplicate identity need definitions

**Type/domain:** unresolved decision plus required contract, matching/provenance. **Evidence:** document ambiguity and code trace. **References:** A9, 8.2.4, 9.2 items 6,7; `types/database.ts:203`; `receiptMutations.ts:1701`; `receiptQueries.ts:273`.

Every rule has an `auto_status`, including default pending. “Best rule that sets status” does not say whether Leave pending is a veto or no status output. The two interpretations produce different receipt-chasing behaviour. Per-field winners also cannot be explained by the single `rule_applied_id` badge. A unique normalised keyword alone can disallow valid rules that differ by direction, amount/type or output; earlier June design defines duplicates using all discriminators and actions.

**Action:** recommend keeping Leave pending as an explicit status choice; do not silently reinterpret it as neutral. Use existing vendor/expense rule IDs for field provenance. Define full normalised match/action identity, declined-proposal policy and grandfathering of existing duplicates before adding uniqueness. Matcher shadow comparison must identify existing changes, not automatically rewrite the corpus.

**Owner/gate:** owner settles status meaning before Release 5; rule developer before Release 4 dedupe/schema. P2 because the ambiguity can be resolved without blocking unrelated safety work. **Verify:** two rules supplying different fields, a pending veto, direction/amount differences, inactive/declined reappearance and displayed provenance.

### RV-14 AI lifecycle cannot be implemented from the listed proposal fields

**Type/domain:** required correction and unresolved product authority, AI/state lifecycle. **Evidence:** document omissions and earlier decision conflict. **References:** A3/A4, 8.2 items 1,3,5,6,7; June rework decisions B/C; `receiptMutations.ts:2019-2031`.

The schema promises once per prompt version but lists no prompt version, attempt state or no-result/failure reason. “No open proposal” includes dismissed and already-tried rows. Accepted “no category applies” remains category-null without a persistent eligibility decision. Payroll proposes a status absent from the schema and normal acceptance contract. The old B decision keeps unmatched rows pending until an approved rule classifies them, and C permits single-evidence rule suggestions; direct per-payment acceptance and the new two-accepted-payment threshold replace those decisions, rather than merely preserve them.

**Action:** record attempt/version/outcome durably, separate transient failure from low-confidence/no-result, and define retry, dismissal and prompt-change eligibility. Make acceptance atomic with current-value/source checks, proposal terminal state and signal. Preserve fields not proposed. Define deterministic payroll source/status and make any closure explicit to the accepting person. Owner approval of A3/A4 must explicitly supersede the affected old decisions. Retain a confidence policy and evaluate representative fixtures; self-reported model confidence is not evidence of correctness.

**Owner/gate:** owner/product decision before Release 4 design; AI developer before implementation. P2 because the feature can be gated. **Verify:** low confidence, missing/foreign IDs, duplicates, partial batch output, acceptance retry, manual edit during inference, new vendor creation cancellation, dismissal, no-category acceptance, prompt upgrade and 401 versus retryable 429/5xx. No model calls in tests.

### RV-15 Completed reasons, file warnings and cleanup need one lifecycle

**Type/domain:** required correction, workflow/data lifecycle. **Evidence:** document gap and code trace. **References:** A2/A12, 10.1/10.2; `receiptMutations.ts:1397-1419,1544-1585`.

The duplicate warning has no stated commit boundary: attachment may already have completed the payment before the user cancels. Hash download failure currently proceeds with a null hash. Completing without evidence gains a reason, but last-file deletion currently reopens the row unconditionally. Existing completion paths include attachment, manual/bulk actions and reconciliation, so guarding only the manual button cannot establish the global “Completed means something” promise.

**Action:** return a typed warning before attachment/status writes; confirmation reuses the owned intent and verified hash. Reject unreadable bytes and recheck duplicate state. Decide the last-file/reason policy and apply the completion invariant to every writer, including old records and undo. Recommend preserving completion only where a recorded reason exists; otherwise reopen visibly. Keep `receipt_required` as a documented derived compatibility field for now, not an independent decision source, until all writers and dependent routines are checked.

**Owner/gate:** owner confirms A2/A12; file/status developer before Release 6. P2, with concurrency/deletion safeguards already P1 in RV-01. **Verify:** warn/cancel/confirm/retry, concurrent same-file uploads, hash failure, attach/delete with and without reason, restore/undo and legacy completed rows. Existing files are not VAT entitlement proof; duplicate document warnings do not establish correct tax treatment.

### RV-16 File decoding and financial time boundaries need current evidence

**Type/domain:** required correction, device compatibility/dates. **Evidence:** code contradiction and code trace; not a fresh device or export repro. **References:** 10.1/10.3; `maintenance/photo-normalise.ts:13-30`; expenses `imageProcessor.ts:129-162`; `oj-project-invoices.ts:197-202,295-298`.

The spec proposes the expenses HEIC converter, but current maintenance guidance explicitly records that packaged Sharp cannot decode real iPhone HEIC and warns against that route. Current OJ paid-at selection uses UTC midnight rather than London quarter boundaries, which can place BST boundary payments in the wrong pack. Passing tests in two zones will not repair a deliberately wrong boundary.

**Action:** use the established browser decoding approach where supported, or clearly reject unsupported HEIC. Preserve readable accounting evidence and define whether hashing identifies original or converted bytes. Derive timestamp boundaries in London while retaining transaction dates as dates. The proposed fixed 2019 minimum needs owner agreement; earliest existing data is not a retention rule.

**Owner/gate:** file/export developer before Release 6, owner date decision before Release 2. P2 because alternate files and explicit boundary logic are available. **Verify:** real iPhone HEIC from Photos and Files, unsupported browser, original/converted duplicate semantics, quarter/year transitions and BST midnight boundaries in London/UTC.

### RV-17 Audit attribution must not hide persistence failure or widen scope silently

**Type/domain:** required correction and scope decision, audit/operations. **Evidence:** live aggregate, code trace and shared standards. **References:** 5.5; `src/services/audit.ts:19-68`.

Session fallback addresses omitted actors but the shared service reads request headers and catches insertion failures. Jobs need explicit initiating/system identity without depending on a live request. A guard checking actor presence does not prove an audit row persisted. Automatic email lookup for each new actor can also add auth calls across the 103 unrelated callers mentioned by the specification.

**Action:** use an explicit authenticated actor for receipts operations and initiating/system attribution for follow-up jobs; never trust a browser-provided actor. Distinguish who initiated from what worker executed. Keep receipts changes narrow unless the owner approves the cross-app fallback. Specify a visible audit failure path and transactional operation history for financially material writes; do not leave a successful mutation unaudited with only console output. Historical anonymous rows remain unknown unless independent evidence exists.

**Owner/gate:** owner confirms shared-service scope; receipts/audit developer before Release 1. P2 because transactional operation history is addressed by the affected P1 findings. **Verify:** request and job contexts, null/missing actor, revoked permissions, audit insertion failure and representative existing non-receipts callers. Confirm the chosen system actor satisfies current foreign keys.

### RV-18 Testing and operational acceptance need release-specific proof

**Type/domain:** required correction, testing/support/delivery. **Evidence:** document gap; existing shared standards already cover parts. **References:** 11.3, existing v2 shadow test requirement, UI and job standards.

Mocked database service tests cannot prove new RPC rollback, unique-index races, permissions or undo. The proposed deployed smoke list is useful but misses merge/undo, stale acceptance, complete pack contents and role denials. New merge/deactivate/create controls and employee access need an explicit permission matrix, though existing `checkUserPermission` and service-role-only RPC conventions already supply the pattern. SEC-02 is appropriately qualified, but should be investigated early because the helper returns a secret; lack of a client import is not build exposure proof.

**Action:** add focused disposable-Postgres tests for the new transactional paths and allow/deny calls; inspect the Next 15 build's server-action surface without returning a real key. Follow existing RLS/grant standards for each table, view and function, and check affected authenticated paths as well as the anon-surface guard. Preserve shared DS labels/focus/dialog patterns; add keyboard, screen-reader feedback and iPad/mobile checks to the changed journeys. Assign an operational responder and documented retry/reconciliation route for failed batches, proposals, incomplete packs and cleanup errors.

**Owner/gate:** developer/tester and owner appointing the responder, before each affected release. P2 as an acceptance contract, not an instruction to build an enterprise monitoring system. **Verify:** the matrix below on supported runtime, full required checks, disposable database and deployed build, with quoted outcomes and deployment ID. Real financial writes, uploads/deletions or live jobs still require explicit owner authorisation.

## Material edge cases and acceptance map

These proposed acceptance additions complement section 11.3. They do not claim implementation exists.

| Journey and actor | Starting state and realistic failure | Required visible result and verification | Findings |
|---|---|---|---|
| Staff imports Bank/Amex | Invalid money/date, quoted row, partial rejection, duplicate file, simultaneous upload | Every data record accounted for; strict amounts; partial acceptance clearly labelled; one committed batch; repeat returns its result. Real parser plus Postgres race tests. | 02,11,12 |
| Worker resumes import | Commit succeeded; response/enqueue lost; rules or vendor list changed | Durable work resumes; rules precede AI eligibility; current protection holds; failures tied to batch rather than green completion. Fault injection. | 02,03,09 |
| Host of historical rule run with super-admin rights | Payment manually changed; rule disabled/edited; lock date changed; role revoked mid-run | No stale overwrite; re-preview or counted conflicts; continuation checks permissions; cancelled/abandoned run has a final recoverable state. | 03,04,12,13 |
| Super admin undoes a run/merge | Some rows edited later; duplicate undo; missing history insert | Original operation cannot commit without recovery data; eligible rows restore and others are named as conflicts. Postgres rollback/concurrency tests. | 05,06 |
| Staff accepts AI proposal | Human edit landed during inference; only one field proposed; model invented ID; no category applies | Atomic compare-and-accept; untouched fields preserved; invalid output rejected; explicit no-category decision prevents repeated inference. | 03,07,14 |
| Staff handles wages | Former employee, abbreviated payee, same name, reimbursement, unknown wage-like description | Local review on ambiguity; explicit proposed closure only for evidenced wage match; whole model request has no employee data. | 07,14 |
| Staff attaches/views/deletes receipt | Two completions; duplicate warning cancelled; hash/storage failure; lost response; last file and reason | No write before duplicate consent; exactly one persisted result; readable object survives replay/sweep; clear viewing error and agreed status after delete. | 01,15,16 |
| Worker pairs invoices | Closed/manual record; multiple references; failure after ledger write; duplicate jobs | Atomic provenance, human locks, review-only ambiguity and bounded allocation; retry never repeats financial entries. | 03,08 |
| Viewer/manager/super admin exports | 1,001+ rows; changed quarter data; one missing file; failed expenses query; mileage failure; disconnect | Stable permitted manifest, no silent metadata omission, missing-file summary, fatal mileage failure retained, accurate build/failure audit. Check archive contents, not HTTP 200 only. | 10,16,18 |
| Keyboard/mobile user changes receipt | Loading, empty result, backend error, modal cancellation, back/reload, lost session | Loading differs from empty/failure; focused labelled controls; return focus; stored proposals/reasons survive refresh; no disappearance after failed optimistic change. Browser and assistive-technology check. | 14,15,18 |

Database integration tests must exercise actual RPCs and schema, not replace the function under test with a mock. Use synthetic financial/employee fixtures. Existing pure matching tests remain useful; do not duplicate implementation logic in the tests. Before changing matcher semantics, shadow the current rule corpus and explain the changed matches for review.

## Decisions requiring owner resolution

Questions are carried back to chat. This register records unresolved subjects, recommendations and timing, not approved decisions.

| Decision | Status and recommended position | Owner and timing |
|---|---|---|
| A1 to A12 defaults | All remain unconfirmed. Adopt only as explicit decisions, with the corrections in this report; A1 must respect human/import locks. A3/A4 replace parts of earlier B/C rather than simply preserving them. | Owner, before each affected release; not a blocker to independent safety work. |
| Leave pending and per-field precedence | Recommend an explicit pending veto; category/vendor can use different winners with honest provenance. No silent neutral interpretation. | Owner, before Release 5 design. |
| Deterministic payroll acceptance | Recommend classification plus an explicit human-approved No Receipt Required change for unambiguous wages; ambiguity stays local/manual. | Owner, before Release 4 design. |
| Period-lock reach | Recommend applying the agreed classification/status lock to every relevant bulk writer, including queued refresh and reconciliation. Allow audited name-only corrections if agreed. Define vendor-merge and manual-override treatment separately. The document promises all bulk protection but names only some writers. | Owner/accountant, before Release 5; gate earlier Accept All/bulk operations if protection is needed. |
| Vendor review collisions | Recommend retaining Action Required where either source has it, and keeping originals for undo. Define watch/default-category collision handling. | Owner, before Release 3 merge. |
| Shared audit fallback | Recommend stamping receipts actors explicitly first; widen shared behaviour only with an agreed regression scope. | Owner, before Release 1 cross-app service change. |
| Strict date range | Recommend strict calendar formats without inventing a fixed 2019 cut-off; agree earliest allowed date and future-date policy from business use. | Owner, before Release 2. |
| D1 to D12 corrections | No approval inferred. D6 is a Release 2 index prerequisite; D3 requires pair review; D7 needs an evidence/reason migration policy. NEST's pension identity/no-receipt ruling is already in the runbook; only the vendor/category correction needs confirmation. | Owner, separately before each correction or dependent migration. |

No data correction, disabling of rules, feature removal, stored-file deletion or migration application is authorised by this review.

## Simplification and optional improvements

The smaller adequate delivery path is to finish the safety contracts first, using current queue uniqueness, field-specific rule IDs, service-role RPC conventions, design-system controls and date helpers. Do not build a new queue, duplicate the vendor model or add new expense categories to solve these defects.

Per-payment AI proposals are justified by the unusable existing queue, but should be a bounded feature with durable attempts and human acceptance. Payroll can remain on current rules until verified local matching is ready. No new payroll rules need be seeded in migrations.

Keep `receipt_required` derived and compatible initially. Dropping it, `category_hint` or a rollback backup is a separate dependency/approval exercise, not a prerequisite for safety. Keep streaming implementation choice with the developer until pack correctness, missing-file handling and measured memory headroom are established; the current 12 MB quarter in the specification does not by itself justify a broader export service.

**RV-19, P3 optional, product measurement:** record simple baselines from existing data for outstanding unclassified money-out rows, proposal acceptance/edit/dismissal, incomplete batches and missing-file packs. Owner chooses meaningful targets after observing them; no numeric target or analytics platform is invented. These measures help establish whether staff work actually decreases after release. Owner/product, after reliable event definitions exist; validate deduped counting.

Two factual refinements do not change the design recommendation: current `normalizeReceiptVendorKey` also collapses internal whitespace (`vendorInsights.ts:28-31`), so VEN-01's “nothing more” wording is too strong; the statement's “all closed again” claims in sections 5.1 and 12 should be reconciled with its “all but one” wording before being used as acceptance evidence.

## Coverage summary

| Area | Review result |
|---|---|
| Product/business and decisions | Reviewed. Outcome is clear; several defaults and superseded decisions need explicit approval. |
| UX/mobile/accessibility | Requirements and existing DS guidance reviewed. Changed journeys need device/focus/feedback acceptance; live usability unassessed. |
| Data/financial lifecycle | Reviewed in depth with live catalogue/aggregates and selective code. Atomicity, identity, provenance and reversal findings above. |
| Integrations/asynchronous operations | Reviewed: OpenAI, Storage, invoice ledger, shared queue and composite export. Supplier portals are operational context, not new integrations. |
| Security/privacy/permissions | Trust boundaries reviewed. Payroll payload risk identified; secret-returning action exposure unverified. No compliance or exploit certification. |
| Performance/cost/reliability | Reviewed proportionately. Avoid page-load inference and unbounded reads; queue starvation is material. No measured production capacity or new numerical SLO. |
| Testing/acceptance/recovery | Focused tests and pure/mock repros executed. Real database, supported-runtime, UTC and deployed paths remain release work. |
| Reporting/VAT/offline accountant work | Reviewed as consumers. Category/P&L decisions remain fixed; uncategorised treatment and VAT document inspection are not redesigned. |
| Content/public discovery/SEO/consent flows | Not applicable to this authenticated administrative change. No evidence supports new public URLs, indexing work or customer campaigns. |
| Licensing/supplier retirement | No material new licence or retirement issue identified from the proposal; a new converter dependency would need its own check. |
| Delivery/ongoing operation | Reviewed. Requires additive compatibility, approved cleanup, named responder and recovery instructions. Production deployment version unverified. |

## Readiness and recommended next steps

**Specification readiness: Not ready for the affected implementation.** Correct RV-01 to RV-12 at their gates and settle the affected decisions. Release 1 should retain its small safety scope but include atomic upload completion, atomic invoice provenance, write-time locks, actor attribution and the changed invoice-status consumer. Independent guards/messages/error states can proceed. Later vendor and AI work should not hold that safety release hostage.

Before Release 2, approve or remove the D6 cleanup dependency, establish real CSV fixtures and recoverable post-import work. Before Releases 3 to 5, resolve canonical identity/undo, AI lifecycle/privacy and rule status/preview contracts. Before Release 6, establish the completion lifecycle and full-pack manifest/failure contract.

For each release, name the migration and approved data work, exercise disposable database failure/concurrency tests, run required lint/typechecks/tests/build on the supported runtime, then verify the actual deployed user path under the correct role. Quote observed outcomes and deployment ID. Do not repeat mutating smoke tests against production without authorisation merely to satisfy a generic checklist.

**Production readiness: Insufficient evidence to assess readiness.** Passing focused unit tests or completing this review cannot change that assessment. No live migration, code deployment or data correction was made here.

The final challenge pass considered compound failures rather than adding generic requirements: a completed import before enqueue, accepted AI followed by rules, merged vendors followed by stale proposals, an open intent followed by conflicting completion and cleanup, and a streamed pack whose underlying records changed. The findings above capture those interactions. No unrelated redesign is recommended.

**Done** - Separate developer review delivered, local only. Original specification, implementation, schema, operational runbooks and existing task files deliberately unchanged. No migration drafted or applied.

**Next:** resolve the release-specific decisions in chat and revise the specification before the affected implementation is committed.
