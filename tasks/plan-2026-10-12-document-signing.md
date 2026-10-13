# Document signing and agreement: implementation plan

> **For agentic workers:** use the implement-plan skill, one release at a time, in order. Steps use checkbox (`- [ ]`) syntax. Read the Global constraints before every task.

**Goal:** One built-in way to send any document to a person, have them read it and agree by typing their name, and keep a locked, evidenced copy on the record it belongs to. No third-party signing service and no running cost.

**Status:** built on branch `feat/signing-foundation` (worktree `OJ-AMS-signing`), 12 October 2026. Not merged, not deployed. The two migrations were applied to production (project `tfcasgxopxegwrabvwat`) on 13 October 2026 with the owner's approval of the exact files, and are recorded there as `20261013080854` and `20261013080952`; the files were renamed to match. Verified after applying: stored SQL matches the approved fingerprints (less the final line break), row security on with no policy, nothing granted to anon or authenticated, the append-only trigger live, twelve templates all switched off, and `assert-anon-surface` passing 9 of 9. Planned against `origin/main` at `a7ac0403`.

**Built differently from the plan (each for a stated reason):**

- One branch with a commit per release, not seven pull requests: all the schema is in the first commit and the releases share files, so splitting them after the fact would only add merge risk.
- Quote acceptance is its own button and email, not a link inside the existing quote email, whose idempotency and delivery logging a personal link would have complicated.
- A contract sent with the self-catering agreement is one request and one signature covering both, with a title that says so. The waiver can still be sent on its own.
- An accepted job offer is noted on the candidate's trail and does not move the application to Hired: hiring stays a staff step.
- Staff notices and emails to workers use the app's default sender. Only Orange Jelly's own clients (quotes and client agreements) get the Orange Jelly invoicing identity.
- Retention is 7 years, not the 6 first chosen: the privacy page already said 7 years for employee and booking records, and the owner chose to match it (13 October 2026). The page now says so.

---

## Owner decisions (12 October 2026)

- Built in. No paid signing service.
- Typed full name plus an "I agree" tick. No drawn signature.
- Capture extra evidence that it was really them (location and device details).
- Build every use case in one run, not just the first.
- Wage deduction consent: not used today, but the option must exist.
- Table booking deposits and event tickets stay out. Paying is the agreement there.
- Anything that needs a witness (leases, guarantees, deeds) stays out.

## What exists today (verified on origin/main)

| Area | Today | Gap |
|---|---|---|
| Private booking contract | Generated, versioned, exact copy stored (`src/lib/private-bookings/contract-lifecycle.ts`). `contract_accepted_at` is set only by a deposit payment (`src/services/private-bookings/payments.ts`). | No signature or agree step. |
| Private booking waiver | Added to the contract for Bring Your Own Food bookings. `waiver_status` is set to `signed` by staff by hand (`src/app/actions/privateBookingWorkflow.ts`). | The customer cannot sign it online. |
| Worker agreement | PDF with blank signature lines (`src/lib/worker-agreement.ts`, `src/app/api/employees/[employee_id]/employment-contract/route.ts`). | Nothing records whether it was signed. |
| Quotes | `status` can be `accepted`, set by staff. | The client cannot accept online. |
| Recruitment | Application status `offered` exists. | No recorded acceptance of the offer. |
| Reusable parts | Hashed one-time link tokens (`src/lib/guest/tokens.ts`), token throttling (`src/lib/guest/token-throttle.ts`), server PDF rendering (`generatePDFFromHTML` in `src/lib/pdf-generator.ts`), `pdf-lib`, private storage buckets, `sendEmail`, `logAuditEvent`, the staff portal at `/portal`. | None; reuse them. |

## Scope: the twelve document kinds

| Kind | Mode | Who signs | Attached to | Wording comes from |
|---|---|---|---|---|
| `employment_agreement` | sign | worker (plus guardian if under 18), company | employee | existing worker agreement template |
| `terms_variation` | sign | worker, company | employee | new template |
| `policy_acknowledgement` | acknowledge | worker | employee | owner's policy text, one template per policy |
| `deduction_consent` | sign | worker | employee | new template, off until the owner turns it on |
| `working_time_opt_out` | sign | worker | employee | new template |
| `guardian_consent` | sign | parent or guardian | employee | new template |
| `job_offer` | sign | candidate | recruitment application | new template |
| `private_booking_contract` | sign | customer | private booking | existing contract template |
| `private_booking_waiver` | sign | customer | private booking | existing waiver annex |
| `quote_acceptance` | sign | client | quote | existing quote PDF plus a short acceptance line |
| `client_agreement` | sign | client, company | Orange Jelly client (`invoice_vendors`) | new template |
| `supplier_confirmation` | sign | supplier | supplier (`vendors`), optionally a booking | new template |

**New wording is never sent until the owner switches that template on.** Every new template ships as a draft, switched off, with starter text clearly marked as a draft. Existing wording (worker agreement, booking contract, waiver) is reused verbatim and is not edited by this work.

---

## How it works

1. Staff press "Send for signature" on the record. The app renders the exact PDF once, stores it in a private bucket and records its SHA-256 fingerprint.
2. Each signer gets an email with their own one-time link (`/sign/<token>`). Only a hash of the token is stored.
3. The signing page shows who it is from, a short plain summary, and a button that opens the exact PDF. The agree button unlocks only after the PDF has been opened.
4. They type their full name, tick "I agree" (or "I have read and understood" in acknowledge mode) and submit.
5. When every signer has signed, the app adds a "Signing record" page to the PDF, stores the final copy with its own fingerprint, emails it to every party and updates the record it belongs to.
6. The record shows status, who signed and when, with download, remind, void and resend.

**Three ways to sign, one record:**

- **Link:** the default, for anyone.
- **Staff portal:** staff with a login see pending documents at `/portal/documents` and sign while signed in. This is the strongest proof of identity we have.
- **In person:** a manager opens a short-lived signing screen on a venue device and hands it over. The record names the manager who was present.

**Changes after signing:** sending a new version voids the outstanding request and marks a completed one as superseded. Signed copies are never altered or deleted.

## Evidence captured ("was it really them")

All free and all without asking the signer for any permission:

- The email address or phone number the link was sent to, taken from the record we already hold.
- Date and time the link was opened, the PDF was opened, and the signature was given (stored in UTC, shown in London time through `dateUtils`).
- IP address, browser and device.
- Approximate location (town, region, country) from the hosting platform's request headers (`x-vercel-ip-city`, `x-vercel-ip-country-region`, `x-vercel-ip-country`).
- Signed-in user id for portal signing; the witnessing manager for in-person signing.
- For a new starter signing by link: date of birth must match the employee record before the agree button unlocks.
- The exact words they agreed to and the fingerprint of the exact PDF they saw.

**Precise GPS is deliberately not used.** The browser shows a location permission prompt, many people refuse it, a refusal blocks or weakens the signing, and it stores more personal data than the purpose needs. Approximate location plus the items above is the better trade.

The evidence trail is append-only: a database trigger refuses updates and deletes on it.

---

## Architecture

**Database (one migration, all schema for the whole programme, so there is one approval):**

- `signing_templates`: `kind`, `title`, `body`, `version`, `is_active`, audit columns. Used by the new kinds and by each policy.
- `signing_documents`: `kind`, `mode`, `title`, `subject_type`, `subject_id`, `version`, `status` (`draft`, `sent`, `part_signed`, `completed`, `declined`, `voided`, `expired`, `superseded`), `source_pdf_path`, `source_sha256`, `final_pdf_path`, `final_sha256`, `supersedes_id`, `expires_at`, `created_by`, timestamps, void reason.
- `signing_parties`: `document_id`, `role`, `signing_order`, `name`, `email`, `phone`, `employee_id`, `customer_id`, `hashed_token`, `token_expires_at`, `status`, `method`, `typed_name`, `agreed_text`, `signed_at`, `signed_ip`, `signed_user_agent`, `signed_city`, `signed_region`, `signed_country`, `auth_user_id`, `witnessed_by`.
- `signing_events`: append-only trail (`created`, `sent`, `opened`, `document_viewed`, `identity_check_failed`, `signed`, `declined`, `reminded`, `voided`, `downloaded`).
- Function `signing_record_signature(...)`: one transaction that claims the party row, writes the event and completes the document when the last party signs. `SECURITY DEFINER`, fixed `search_path`, `EXECUTE` granted to `service_role` only.
- Private bucket `signed-documents`, no storage policies (service role only, as with `private-booking-documents`).
- RLS on all four tables. No `anon` grant on anything. Staff read through the existing permission of the record the document belongs to.

**Code:**

- `src/lib/signing/`: `kinds.ts` (the single registry: kind, mode, parties, subject, permission, brand, on-completed hook), `tokens.ts`, `evidence.ts` (IP, device, location), `render.ts` (PDF snapshot and fingerprint), `certificate.ts` (the signing record page, `pdf-lib`), `emails.ts`, `service.ts`.
- `src/app/actions/signing.ts`: send, remind, void, resend, in-person start. Zod, `checkUserPermission`, `logAuditEvent`, `revalidatePath`.
- `src/app/sign/[token]/` and `src/app/api/sign/[token]/`: public page and endpoints. Admin client only. New `'/sign'` entry in `PUBLIC_PATH_PREFIXES`.
- `src/app/(staff-portal)/portal/documents/`: staff signing while signed in.
- `src/components/features/signing/SignaturePanel.tsx`: one panel dropped into each record page.
- `src/app/(authenticated)/settings/signing-templates/`: view, edit, switch on or off.

**Permissions:** no new RBAC module and no grant migration. Each kind maps to an existing permission: staff kinds to `employees` `edit` (read: `view_documents`), booking kinds to `private_bookings` `generate_contracts`, quotes to `quotes` `send`, client agreements to `oj_projects` `edit`, supplier confirmations to `private_bookings` `manage_vendors`, job offers to `recruitment` `edit`, templates to `settings` `manage`.

**Branding and sender:** staff, client and quote documents use the `STAFF` palette and go out as Orange Jelly; booking and supplier documents use the `GUEST` palette and go out as The Anchor. Every PDF carries the right logo (owner rule, 5 October 2026).

**Messaging:** email only, through `sendEmail`, so every kill switch applies. No SMS (owner rule, 15 September 2026). A person with no email signs in person.

---

## Releases

One continuous run, seven pull requests, each safe to deploy on its own. All schema is in Release 1.

### Release 1: foundation (`feat/signing-foundation`)

- [ ] Migration: four tables, function, bucket, RLS, grants. Draft and review through the prod-migrate skill.
- [ ] `src/lib/signing/` with the kind registry (all twelve kinds declared, hooks empty for now).
- [ ] Public `/sign/[token]` page and endpoints, with rate limiting and token throttling.
- [ ] Signing record page appended with `pdf-lib`; final copy stored and fingerprinted.
- [ ] Emails: request, reminder, completed copy, declined notice to staff.
- [ ] `SignaturePanel` and server actions (send, remind, void, resend, in-person).
- [ ] Templates settings page, with the new kinds seeded as drafts, switched off.
- [ ] `/privacy` page: one paragraph on what signing records and why.
- [ ] **CLAUDE.md, `docs/agent-reference.md` and the guard test (see below). They land here, with the code, not at the end.**
- [ ] Tests listed under Test plan.

### Release 2: staff (`feat/signing-staff`)

- [ ] Employment agreement: send from the employee page; signing step added to new-starter onboarding after the account step; guardian added automatically when the worker is under 18.
- [ ] Onboarding checklist item "Employment agreement signed" ticks itself on completion.
- [ ] Terms variation, deduction consent, 48-hour opt-out, guardian consent: send from the employee page.
- [ ] Policy acknowledgements: send one policy to all active staff, and a "who has and has not" list with a chase button.
- [ ] `/portal/documents`: pending and signed documents for the signed-in worker.

### Release 3: recruitment (`feat/signing-job-offer`)

- [ ] Send an offer from an application at `offered`; acceptance or decline is recorded on the application through the existing status transition function.

### Release 4: private bookings (`feat/signing-private-bookings`)

- [ ] The send-contract action includes the signing link. Signing sets `contract_accepted_at` with method `e_signature`. A deposit payment still counts as acceptance, exactly as now.
- [ ] Waiver signed online sets `waiver_status` to `signed`. Marking it by hand still works.
- [ ] A new contract version voids or supersedes the earlier request.
- [ ] Check the website repo for anything that reads contract or waiver state and say so in the PR (paired repository rule).

### Release 5: quotes and Orange Jelly clients (`feat/signing-quotes-clients`)

- [ ] Quote email carries an "Accept this quote" link; signing sets the quote to `accepted`.
- [ ] Client agreement sent from the Orange Jelly client page.

### Release 6: suppliers (`feat/signing-suppliers`)

- [ ] Supplier confirmation sent from the supplier, optionally tied to a booking, with date, fee and cancellation terms merged in.

### Release 7: chasing and overview (`feat/signing-reminders`)

- [ ] Daily cron `signing-reminders` in `vercel.json`: reminder at 3 and 7 days, expiry at 30 days with an alert to staff. Uses `cron-auth` and the cron alert email.
- [ ] One staff page listing every outstanding and completed document across all kinds, with filters.

---

## Keeping future work on this feature

Added in Release 1, in the same pull request as the code, so the rule and the feature arrive together.

**CLAUDE.md, new entry under Domain rules:**

> **Signatures and agreements go through the shared signing feature** (`src/lib/signing/`). Anything a person must sign, accept or acknowledge (staff, customer, client or supplier) is a kind in `src/lib/signing/kinds.ts`, sent with the `SignaturePanel` and signed at `/sign/<token>`, in the staff portal or in person. Never build a one-off agree box, a hand-set "signed" flag or a new signed-at column. A new document type means a new kind in the registry, a template and its tests. Signed copies and the evidence trail are never edited or deleted; a change means a new version. Exceptions: table booking deposits and event tickets (paying is the agreement) and anything that needs a witness. Owner decision, 12 October 2026.

**Also:** a Known gotchas line (the signing page shows the server-rendered PDF, never the fixed A4 HTML, because of the browser minimum font size trap), a row in `docs/agent-reference.md` for the public `/sign` prefix and the new cron, and `tests/guards/signing.test.ts`, which fails when:

- a kind in the registry has no template, no completion hook or no test, or
- new code or a new migration adds a column or field matching `signed_at`, `signature`, `agreed_at` or `accepted_at` outside `src/lib/signing/` and a short allowlist of today's existing ones.

A rule is only real when a test enforces it (lesson of 18 September 2026).

---

## Test plan

- Unit: tokens, evidence parsing, fingerprinting, kind registry, signing record page content.
- Fail closed (workspace rule for public write paths): with the database, storage and email each made to fail in turn, the signer sees a clear error and a fallback contact, nothing is recorded as signed, and staff are alerted.
- Security: unknown, expired, used and voided tokens return the same neutral page; throttling after repeated bad tokens; no staff page reachable under `/sign`; `npx tsx scripts/security/assert-anon-surface.ts` passes after the migration.
- Concurrency: two signers finishing at once produce one completed document (Postgres harness under `scripts/testing/`, run by `npm run test:pg`).
- Tamper: the evidence trail rejects update and delete.
- Templates and emails rendered with fixture data; fail on `undefined`, `Invalid Date`, `NaN` or a blank name.
- Dates: both `npm test` (London) and `npm run test:utc`, including a signature given either side of a clock change.
- Per kind: send, sign, completion hook updates the right record, new version supersedes the old.
- Browser: the full path on a phone-sized screen in a preview deployment, for one staff kind and one customer kind, including checking that the location headers are present in production hosting.

## Global constraints

- British English, no em dashes anywhere (hooks block them).
- Node 20: `source ~/.nvm/nvm.sh && nvm use` in the same call as every gate.
- Gates per release: `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:tests`, `npm test`, `npm run test:utc`, `npm run test:pg`, `npm run build`.
- Build in a worktree off a fresh `origin/main`, never in the primary folder (it is 177 commits behind and has another session's uncommitted work).
- Migration before code: the Release 1 migration is applied to production, with the owner's explicit go-ahead, before any code that needs it is deployed.
- UI from `@/ds` with design tokens only; run the ui-standards-enforcer agent on each new page.
- Both logo files bundled with every new PDF route through `outputFileTracingIncludes`.

## Assumptions

- Signed documents and their evidence are kept for 7 years after the relationship ends (owner decision, 13 October 2026, to match the privacy page's existing 7 years for employee and booking records), then removed by hand. No automatic deletion is built.
- Reminders go at 3 and 7 days and a request expires at 30 days.
- The company side is signed by the sender at the moment of sending, in the name already used on the worker agreement.
- Orange Jelly clients are rows in `invoice_vendors` and suppliers are rows in `vendors` (confirmed in the generated types).
- Existing signed-by-hand records are left as they are. Nothing is backfilled.
- A typed name with a recorded agreement is treated as sufficient for these document types. This has not been checked with a solicitor.

## Out of scope

Table booking deposits, event tickets, parking, witnessed documents, drawn signatures, precise GPS, SMS delivery, any paid signing or identity service, and rewriting the wording of the existing worker agreement, booking contract or waiver.
