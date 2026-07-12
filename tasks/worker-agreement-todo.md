# Employee Zero-Hours Worker Agreement — redesign

Replace the existing plain "Casual Worker Agreement" employee PDF with the branded A4
handoff design, merging all available employee fields and conditionally appending the
Young Worker Schedule (page 11) only for 16–17 year-olds.

## Decisions (locked with owner)
- Replace the existing contract (route `/api/employees/[employee_id]/employment-contract`), retire old Arial template.
- Auto-fill base hourly rate + NMW age band from the rota pay system.
- Prefill agreement date = today (London); issuing manager = logged-in manager (Peter Pitcher).
- Missing DOB → omit Schedule 2, treat as 18+, leave age line blank.

## Field mapping
- Worker name = `first_name last_name`; initials from those.
- Address = `address` + `post_code`.
- DOB line = `formatDateDdMmmmYyyy(dob)` + ` (16–17)`/` (18+)`; blank if no DOB.
- Job title, start date from `employees`.
- Hourly rate via `getHourlyRate(id, today)`; NMW band = matching `pay_age_bands.label`.
- Young Worker applies = age 16–17 at agreement date → include Schedule 2.
- Year = agreement date year; doc ref `ANC/CWA/{year}/{initials}`.

## Tasks
- [ ] `src/lib/worker-agreement.ts` — pure field derivation + WorkerAgreementData type (+ tests)
- [ ] `src/lib/worker-agreement-template.ts` — A4 HTML generator (transformed from handoff, verbatim copy)
- [ ] Rewrite route to fetch inputs, resolve rate/band/manager, render new template, return PDF
- [ ] Reuse `CONTRACT_LOGO_DATA_URI` (Anchor black wordmark) as the header logo
- [ ] Remove dead `employment-contract-template.ts` once unreferenced
- [ ] Unit tests for age/category/young-worker/initials/doc-ref (boundaries + missing DOB)
- [ ] Verify: lint, typecheck, build, and render a real PDF (18+ = 10 pages, 16–17 = 11 pages)

## Review — DONE 2026-07-12
- New files: `src/lib/worker-agreement.ts` (pure logic + type), `src/lib/worker-agreement-template.ts`
  (A4 HTML, auto-generated verbatim from handoff), `src/lib/__tests__/worker-agreement.test.ts` (14 tests).
- Route `…/employment-contract/route.ts` rewritten: resolves rate (getHourlyRate), NMW band label
  (pay_age_bands match), issuing manager (auth user → employees name → metadata → email), agreement
  date = today London. Renders new template, returns attachment PDF (preferCSSPageSize + zero margins).
- Reuses `CONTRACT_LOGO_DATA_URI` (Anchor black wordmark). Dead `employment-contract-template.ts` removed.
- Button on employee page unchanged (same route) — now serves the branded design.
- Verified: full `tsc --noEmit` clean, eslint clean on changed files, 14/14 tests pass. Rendered real
  PDFs — adult = 10 pages (18+, Young Worker "No", "Page N of 10"); under-18 = 11 pages (16–17,
  "Yes", Schedule 2 appended, "Page N of 11"). All fields merge as finished text; blanks fall back to
  fill-in lines. Cover/Schedule 1/Schedule 2 pixel-faithful to handoff.
- NOT run: full `npm run build` (a parallel session's dev server is using `.next`; avoided disruption).
- NOT committed: branch `codex/vendor-spend-movements` also carries a parallel session's uncommitted
  recruitment.ts/ai.ts edits — left untouched; owner to commit worker-agreement files independently.

## Round 2 — owner content amendments 2026-07-12
Clause copy is now owner-maintained in `worker-agreement-template.ts` (banner updated; no longer
"auto-generated verbatim"). Applied and re-rendered (no page overflow, 10/11 pages intact):
- 4.1 planning offer shows date+time+rate only; role/duties per Schedule 1; location always The Anchor.
- 4.2 two-week (14-day) auto-accept if not declined; 4.3 references it; 4.4 new cover-responsibility clause.
- 6.1 clock in/out on "our till and booking system".
- 7.7 must disclose other employment (assumed only job unless told); 7.8 own tax responsibility (HMRC).
- 8.1 holiday year 1 January–31 December (was 1 April–31 March).
- Removed 9.4 (48-hour opt-out) — we don't offer more than that.
- 11.1 sick reported by phone to Billy Summers 07956 315214 / Peter Pitcher 07990 587315 / duty mgr 01753 682707.
- 14.2 + 17.1 topic lists converted from inline `.mini-list` to real bullet lists (`.blist`, multi-column).
- 15.2 removed "unless expressly given to you".
- 16.1 tips: staff asked NOT to accept; if they do, it's theirs and their own tax responsibility.
- 17.2 new competitor-exclusivity clause (no other pub/bar within 3-mile radius without written consent).
- 20.5 new: lawful/instructed deductions (attachment of earnings etc.) made in accordance with the law.
- Issuing manager now FIXED to "Peter Pitcher (peter@orangejelly.co.uk)" in signature card (was logged-in user).
- NEW `src/lib/names.ts` normalizePersonName (7 tests). Names normalised on create/update in
  `EmployeeService` AND normalised + persisted (admin client, best-effort) in the contract route before render.
- Re-verified: tsc clean, eslint clean, 21 tests pass, both PDFs re-rendered and read back OK.
- OPEN interpretation flagged to owner: issuing manager fixed to Peter (could be made dynamic-per-manager).
