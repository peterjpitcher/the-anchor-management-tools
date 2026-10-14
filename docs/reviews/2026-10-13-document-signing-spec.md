# Document signing: what was built, for independent review

Date: 13 October 2026. Application: Anchor Management Tools (`OJ-AnchorManagementTools`), the live staff app at `management.orangejelly.co.uk`. Stack: Next.js 15 App Router, React 19, TypeScript strict, Supabase (Postgres 15.8), Vercel.

This document describes everything built for document signing so that a third party can review it. It covers two pieces of work: the first release, which is live, and a follow-up made after the owner's first live test, which is not live yet. Section 10 lists where a reviewer should push hardest. Section 8 lists what is known to be missing.

Revision 2, 13 October 2026: an independent review of revision 1 found several reliability and security claims overstated. Section 11 lists each finding and what was done. Sections 4.3, 4.4, 4.8 and 6.3 have been corrected to say what the code does.

## 1. Status

| Piece | State | Where |
|---|---|---|
| First release: shared signing feature, twelve document kinds | Live since 13 October 2026 | PR 204, merge commit `e6343e98`, deployment `dpl_2RjiX2qi7Ah2NNh8VNchX7J6sDUV` |
| Database: four tables, two functions, one trigger, one private bucket, twelve draft templates | Applied to production | `20261013080854_document_signing_foundation`, `20261013080952_document_signing_template_drafts` |
| Follow-up: food agreement fix, separate signing, signatures shown on the signed copy, withdrawn requests | Local commits only, not pushed, not live | Branch `fix/signing-live-test-followups`, worktree `/Users/peterpitcher/Cursor/OJ-AMS-signing-followups` |
| Booking form desktop layout (unrelated to signing, same owner request) | Local commits only, not pushed, not live | Branch `fix/private-booking-form-desktop-layout`, worktree `/Users/peterpitcher/Cursor/OJ-AMS-pb-form` |

The follow-up needs no database migration. Sample output from the follow-up, rendered from the real templates with made-up people, is in `tasks/previews/signing-2026-10-13/`.

## 2. What the owner asked for

Decisions given on 9 to 13 October 2026:

- Built in. No paid signing service.
- A typed full name plus an "I agree" tick. No drawn signature.
- Capture extra evidence that it was really them (location, device and so on).
- Build every use case in one go.
- Wage deduction consent must exist as an option but is not in use.
- Table booking deposits and event tickets stay out (paying is the agreement). Anything needing a witness stays out.
- Keep signed records for seven years.
- Remind at 3 and 7 days, expire at 30.
- New wording is drafted for the owner and cannot be sent until the owner completes it and switches it on.
- The project rules must say that this feature is always used for anything a person signs.

Given on 13 October 2026, after the first live test:

- The food agreement must be signed separately from the booking contract.
- The signed copy should show that it was signed electronically, with the person's name, date, time and location.

## 3. The twelve document kinds

One registry, `src/lib/signing/kinds.ts`, defines every kind. "Business signs" means the business is a signatory, and signs at the moment a member of staff sends the document, in that person's name.

| Kind | Mode | Signers | Business signs | Attached to | Wording from | What signing changes |
|---|---|---|---|---|---|---|
| `employment_agreement` | sign | worker, plus parent or guardian if under 18 | yes | employee | existing worker agreement template | ticks "agreement accepted" on the onboarding checklist |
| `terms_variation` | sign | worker | yes | employee | new template | record only |
| `policy_acknowledgement` | acknowledge | worker | no | employee | one template per policy | record only; the Policies page shows who has confirmed which version |
| `deduction_consent` | sign | worker | no | employee | new template, switched off | record only |
| `working_time_opt_out` | sign | worker (refused for under 18s) | no | employee | new template | record only |
| `guardian_consent` | sign | parent or guardian | no | employee | new template | record only |
| `job_offer` | sign | candidate | no | recruitment application | new template | adds a note to the candidate; does not hire them |
| `private_booking_contract` | sign | customer | yes (from the follow-up) | private booking | existing contract template | marks the contract accepted by e-signature, for that contract version only, unless already accepted |
| `private_booking_waiver` | sign | customer | no | private booking | existing self-catering annex | marks the food agreement signed |
| `quote_acceptance` | sign | client | no | quote | the quote itself | marks the quote accepted, unless staff changed its status or its total changed |
| `client_agreement` | sign | client | yes | Orange Jelly client | new template | record only |
| `supplier_confirmation` | sign | supplier | no | supplier, linked to a booking | new template | record only |

Each kind maps to an existing permission; there is no new permission module. Staff kinds need `employees` `edit` to send, bookings `private_bookings` `generate_contracts`, supplier confirmations `private_bookings` `manage`, quotes `invoices` `edit`, client agreements `oj_projects` `edit`, job offers `recruitment` `edit`, templates `settings` `manage`.

## 4. How it works (first release, live)

### 4.1 Send

1. Staff press a send button on the record (employee, application, booking, quote, client).
2. The server checks the permission, renders the PDF once, stores it in the private bucket `signed-documents` and records its SHA-256 fingerprint. This file is what every signer is shown.
3. A row is written to `signing_documents`, one row per signer to `signing_parties`, and events to `signing_events`.
4. Each signer with an email address is emailed a personal link, `/sign/<token>`. The token is 32 random bytes; only its SHA-256 hash is stored. The copy of the email kept in the email log has the token removed (`logRedactions` on `sendEmail`).
5. Sending a new version of the same document for the same record withdraws the earlier unsigned request. A signed earlier version is marked replaced only once the new one is signed.

### 4.2 Sign

Three ways, one record:

- **By link.** The page shows who sent it and a summary. The name box and tick stay locked until the signer has opened the PDF. They type their full name, tick the box and submit. The exact words they agreed to are sent with the signature and must match what the server would show.
- **In the staff portal.** Staff with a login sign at `/portal/documents` while signed in. The signed-in user id is recorded.
- **In person.** A manager starts a 30 minute session; the signer opens it on another device by QR code. The record names the manager present.

A new starter signing by link must first enter their date of birth, which must match the employee record. Five wrong answers lock the link; the count is kept in the database and checked in one statement.

A signer can decline with a reason. The sender is told.

### 4.3 After the last signature

Finishing is three separate steps, each claimed in the database so that it runs once however many callers arrive:

1. Build the signed PDF and store it (`final_pdf_path`, `final_sha256`).
2. Email the signed copy to every signer, and a notice (no attachment) to the member of staff who sent it (`copies_sent_at`).
3. Apply the change to the record, the "completion hook" (`completion_applied_at`), run first and recorded second so a failure is retried.

A failure in any step leaves the signature in place and raises an alert email. Steps 1 and 3 are retried by the daily job and on the next staff download.

Step 2 as live today: the step is claimed before sending and the claim is kept if an email fails, so a failed signed copy is never sent again automatically. The alert names who missed out and staff send it by hand. Revision 1 of this document wrongly said it was retried.

Step 2 in the follow-up: each delivery is written to the trail as it happens. A copy the provider definitely refused is tried again by the daily job for three days (for as long as it lasts if email is switched off). A copy whose outcome is not known is never sent again automatically, because it may have arrived. The signed file is checked against its fingerprint before it is emailed or downloaded.

Step 3 can run more than once if two callers arrive together. Each hook is written to be safe to repeat; a candidate note could in theory be written twice.

### 4.4 Chasing

A daily job (`/api/cron/signing-reminders`, 09:30 UTC, cron bearer secret) reminds at 3 and 7 days, expires requests at 30 days and tells the sender, and finishes any signed document whose finishing steps did not complete. A reminder issues a new link and kills the old one, because old links cannot be re-sent from a hash.

As live today, the old link is killed and the reminder counted before the email is sent, so a failed reminder leaves the signer with no working link and uses up a reminder. In the follow-up a reminder the provider refuses puts the earlier link back and is not counted, two sends at the same moment cannot clash, and a new link carries nothing over from the old one: the date of birth check and opening the document are done again.

### 4.5 Evidence recorded for each signature

- The name on our records and the name typed.
- The exact words agreed to.
- When the link was first opened, when the PDF was opened, when it was signed (stored in UTC, shown in UK time).
- IP address, browser and device.
- Approximate location (town, region, country) from Vercel's request headers. No GPS and no permission prompt.
- The email address the link was sent to.
- For the portal, the signed-in user; for in person, the manager present; for a new starter by link, that the date of birth matched.
- The fingerprint of the exact PDF shown.

The trail (`signing_events`) is append-only: a trigger refuses updates and deletes. Nothing in the code deletes a signed document or its trail; removal at the end of the seven years is a deliberate manual act.

### 4.6 Data model

- `signing_templates`: wording for the new kinds and for each policy, versioned, with an on or off switch. Twelve rows were seeded switched off, with gaps marked `[[TO CONFIRM: ...]]`. A template with a gap cannot be switched on or sent.
- `signing_documents`: kind, mode, title, the record it belongs to (`subject_type`, `subject_id`), a series key and version, status (`sent`, `part_signed`, `completed`, `declined`, `voided`, `expired`, `superseded`), source and final PDF paths and fingerprints, expiry, the three finishing timestamps, a `context` JSON column.
- `signing_parties`: one per signer, with the hashed token, identity check state, and the evidence columns.
- `signing_events`: the append-only trail.
- `signing_record_signature` and `signing_record_decline`: each records one signature or refusal in one transaction, and completes the document when the last signer signs. They run as the caller (`SECURITY INVOKER`) and only `service_role` may execute them.

All four tables have row level security on and every privilege revoked from `PUBLIC`, `anon` and `authenticated`. Only server code using the service role reaches them, after its own permission check. The bucket has no storage policies.

### 4.7 Where it appears

- Public: `/sign/[token]` and `/api/sign/[token]/{document,identity,sign,decline}`. `/sign` was added to the public path list in `src/middleware.ts`.
- Staff portal: `/portal/documents` and `/api/portal/signing/[partyId]/{document,sign,decline,signed}`.
- Staff app: a signing panel on the employee, recruitment application, private booking, quote and client pages; `/signatures` (everything outstanding); `/employees/policies`; `/settings/signing-templates`; `/api/signing/documents/[id]/pdf`.

### 4.8 Security measures in the first release

- Every public endpoint is throttled, uses the service role only after resolving the token, and gives an unknown link a neutral 404. The throttle is one allowance per link and IP address together, not two independent limits, and its counter is not atomic, so it slows guessing but is weaker than revision 1 said. A link we recognise that has expired or been withdrawn answers 410 with a specific message, and its page still shows the document title and the recipient's name: it is not treated like an unknown link.
- A signed link stops serving the PDF once the document is finished and the copies have gone; the signer has the emailed copy.
- Links are never copied to anyone (no cc or bcc).
- A stored file that no longer matches its fingerprint is refused and raises an alert. As live today this covers the file shown to signers only. The follow-up extends it to the signed copy (on every download and email) and to the stored HTML the signed copy is rendered from.
- In-person signing runs on the signer's device, not in the manager's signed-in browser.
- Email only, through `sendEmail`, so every kill switch applies. No SMS.

An internal security review before release found and fixed: the token appearing in the email log; in-person signing inside the manager's session; a signed link serving the PDF indefinitely; a date of birth lockout that could be raced; the completion step being marked done before it had run; and a signer's copy not being sent if the record update failed.

### 4.9 Files in the first release

- Migrations: `supabase/migrations/20261013080854_document_signing_foundation.sql`, `20261013080952_document_signing_template_drafts.sql`.
- Library: `src/lib/signing/` (`types`, `kinds`, `tokens`, `evidence`, `agreement-text`, `template-text`, `template-render`, `template-fields`, `templates`, `certificate`, `emails`, `service`, `subjects`, `completion-hooks`, `public-request`, `portal`, `portal-request`, `view-model`, `staff`, `send-template`, `policy`, `reminders`, and `documents/worker-agreement`, `documents/booking-contract`).
- Server actions: `src/app/actions/signing.ts`, `signing-staff.ts`, `signing-recruitment.ts`, `signing-bookings.ts`, `signing-commercial.ts`.
- Routes and pages: as listed in 4.7, plus `src/app/api/cron/signing-reminders/route.ts`.
- Components: `src/components/features/signing/` and `src/components/features/guest/signing/SigningGuestView.tsx`.
- Tests: `tests/lib/signing/`, `tests/api/signing/`, `tests/actions/signing-*.test.ts`, `tests/components/signing/`, `tests/guards/signing.test.ts`, and a real Postgres harness `scripts/testing/document-signing-postgres.py`.
- Rules: a paragraph in `CLAUDE.md` making the feature mandatory for anything signed, and a guard test that fails on an incomplete kind or a signature field outside the feature.
- Plan as approved: `tasks/plan-2026-10-12-document-signing.md`.

## 5. The first live test, and what it showed

On 13 October 2026 the owner sent a booking contract from a test booking with "Outside food" ticked, and signed it by link. The signing itself worked end to end against production: the link opened, the PDF was viewed, the signature was recorded with IP address and location ("Staines, ENG, GB"), the signed copy was built and emailed, and the booking was marked accepted.

Three faults came out of it:

1. **No food agreement.** The contract had no self-catering agreement. The agreement was triggered only by a catering package flagged as needing one. The "Outside food" tick on the booking form was read by nothing. Three live bookings have the tick and no agreement (events on 24 October, 1 November and 4 November 2026; the last is the test). This fault predates the signing work but the signing work relied on the same rule.
2. **One signature for two documents.** Where a food agreement was included, one signature on the contract was treated as signing both. The printed agreement says its signature is separate.
3. **Signed copy looked unsigned.** The signed copy was the original PDF, with its blank signature lines, plus a signing record page at the end.

A sweep of the rest of the application for the same kind of gap found more; those not fixed are in section 8.

## 6. The follow-up (not live)

### 6.1 One rule for "this booking needs the food agreement"

A booking needs it when the "Outside food" tick is set, or when it has a catering package flagged as needing it.

- `src/lib/private-bookings/waiver-status.ts` (new): `effectiveWaiverStatus` reads a stored `not_required` as `required` when the tick is set, so existing bookings are right without changing stored data. `waiverIsOutstanding` is true for required, sent and overdue.
- `src/lib/contract-template.ts`: the contract includes the agreement pages for the tick as well as the package.
- `src/services/private-bookings/mutations.ts`: the stored status is reconciled when the tick is set at intake and when it changes on edit. Only a package turns the tick on. A failure to reconcile is logged and does not fail the save.
- When staff untick "Outside food" and no flagged package remains, an unsigned agreement returns to not required (from required, sent or overdue), with an audit row, and its open signing request is withdrawn. Before this, the rule never moved a sent agreement back, which left the event sheet blocking for food that was no longer coming and gave staff no honest status to set. A signed agreement is never changed.
- Readers switched to the effective status: the booking workflow panel, the event sheet and its "unsigned food agreement" blocker (which now also fires for overdue), and the signing panel.

### 6.2 The food agreement is a second document with its own signature

- `src/lib/signing/documents/booking-contract.ts` (rewritten): the contract HTML is rendered once and divided by page into two documents, the contract and the food agreement. Two signing requests are created, one of each kind, to the same customer.
- `src/app/actions/privateBookingActions.ts` (`sendBookingContract`): one email carries both, with two numbered buttons and both PDFs attached (`src/lib/email/private-booking-emails.ts`). Both tokens are removed from the email log. If the email fails, both requests are withdrawn. If the second request cannot be created, the first is withdrawn.
- The booking is marked as having had the food agreement sent only after the email carrying it has gone (`markWaiverSent` in `src/lib/private-bookings/contract-lifecycle.ts`). Before this it was marked when the contract was generated, so a failed email left the booking saying the agreement had been sent.
- A food agreement that is already signed is not sent again when a new contract version goes out. The contract goes alone. To ask for it again, staff set its status back to required first.
- The contract's completion hook no longer marks the food agreement signed. Only the food agreement's own hook does.
- `sendBookingWaiver` sends the food agreement on its own, for a booking whose contract has already gone. The booking panel offers "Send Food Agreement to Sign" when one is outstanding and none is open.
- The signing screen names any other document the same person still has to sign on the same record, before and after signing, so one signature is never mistaken for both.
- The page split is held to a page count: each sheet of the contract template prints as one page, and the split refuses to run, at send and when the signed copy is built, if the render has a different number of pages or if the agreement's signature place and its pages do not agree.

### 6.3 Signatures shown where they belong on the signed copy

- `src/lib/signing/signature-slots.ts` (new): a template marks each signature place with a comment marker. Before signing, each place prints "To be signed electronically". After signing it prints the name typed, the date and time, the approximate location, how they signed and a reference to the signing record. Per-page initials boxes are replaced by one line of text.
- `src/lib/signing/render.ts`, `prepare.ts`, `slot-fills.ts` (new): the document's HTML is stored beside its PDF when it is sent, with its own fingerprint. When the last signature arrives, that stored HTML is rendered again with the signature places filled in, and the signing record page is appended. The HTML is the stored copy, so a later edit to the booking or employee cannot change what the signed copy says.
- What this does and does not guarantee: the two renders start from identical HTML apart from the signature places. It is not proof that the two PDFs are otherwise identical. The contract loads its fonts from Google at render time, and Vercel's browser can differ from one day to the next, so text could wrap differently in the second render. The fixed A4 sheets clip overflow, so lost text would not change the page count. The file each signer was shown is always kept, fingerprinted and downloadable, and is the evidence of what was agreed; the signed copy is a presentation of it.
- The fingerprint on the signing record remains that of the file each signer was shown. The record page now says that the pages before it are that document with each signature panel completed.
- A document sent before this change has no stored HTML and keeps the earlier behaviour (original PDF plus record page).
- If a template has lost a signature place, the send stops. If the stored HTML cannot be read when finishing, the signature stands, no signed copy is issued, an alert is raised and the daily job retries.
- Applied to: the booking contract and food agreement (`contract-template.ts`), the worker agreement including the parent or guardian block (`documents/worker-agreement-slots.ts`), every template kind (`template-render.ts`, a "Signatures" or "Confirmation" section), and quotes (`documents/quote.ts`, an "Accepted Online" panel above the footer).
- The business's signature shows the name and job title of whoever sent the document (`employees.job_title`, read in `src/lib/signing/staff.ts`).
- The booking contract now has the business as a signatory, signed on sending, so its "For The Anchor" block is not left blank.

### 6.4 Requests withdrawn when the record moves on

Before this, cancelling a booking or accepting a quote by phone left a live signing link behind.

- `src/lib/signing/subject-state.ts` (new): one check that the record still needs signing. A request is withdrawn when the booking is cancelled or gone, when staff have recorded the food agreement as signed, when a supplier confirmation's booking is cancelled, when the quote is accepted, rejected, expired or past its valid-until date, when the employee has left, or when a recruitment application is no longer at the offer stage.
- It runs when the link or portal page is opened, on every public and portal request, immediately before a signature is recorded, and in the daily job before any reminder. A withdrawn request is recorded in the trail as automatic, with the reason.
- The check never guesses. If the record cannot be read it throws: on the signing page that is an error and no signature is taken, and in the daily job that request is not chased that day and the failure is reported.
- Marking a food agreement signed by hand, or uploading a signed one, withdraws an open request the next time it is opened or at the next daily run, not at the moment staff press the button.

This was done centrally and lazily so that no existing lifecycle action had to be taught about signing.

### 6.5 Other fixes in the follow-up

- `src/services/private-bookings/payments.ts`: paying the deposit no longer overwrites a contract acceptance that already exists (for example one made by e-signature an hour earlier).
- `src/lib/private-bookings/contract-lifecycle.ts`: the "sent" stamp on the food agreement now applies from `not_required` as well as `required`.
- The kind's label changed from "Waiver" to "Food agreement" on staff screens.

### 6.6 Files in the follow-up

New: `src/lib/private-bookings/waiver-status.ts`, `src/lib/signing/signature-slots.ts`, `render.ts`, `prepare.ts`, `slot-fills.ts`, `subject-state.ts`, `documents/quote.ts`, `documents/worker-agreement-slots.ts`.

Changed: `src/lib/contract-template.ts`, `src/lib/private-bookings/contract-lifecycle.ts`, `event-sheet.ts`, `src/services/private-bookings/mutations.ts`, `payments.ts`, `src/lib/email/private-booking-emails.ts`, `src/app/actions/privateBookingActions.ts`, `signing-bookings.ts`, `signing-staff.ts`, `signing-commercial.ts`, `src/app/api/private-bookings/event-sheet/route.ts`, `src/app/sign/[token]/page.tsx`, `src/app/(staff-portal)/portal/documents/[partyId]/page.tsx`, `src/lib/signing/` (`service`, `certificate`, `completion-hooks`, `kinds`, `staff`, `templates`, `template-render`, `send-template`, `view-model`, `public-request`, `portal-request`, `reminders`, `documents/booking-contract`, `documents/worker-agreement`), `src/components/features/signing/` (`BookingSigningPanel`, `SigningStaffView`, `useSigningFlow`), `src/components/features/guest/signing/SigningGuestView.tsx`, `src/components/private-bookings/WorkflowPanels.tsx`, `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx`, `tasks/lessons.md`, and tests.

Deliberately left alone: the wording of every existing document (contract terms, food agreement terms, worker agreement, quote), the database schema, the public endpoints' contracts, and the SMS and email kill switches.

## 7. Booking form layout (separate branch)

The new and edit private booking forms sat in a 712 pixel column against the left edge on a desktop screen, because both pages were given the narrow "single form" width on 26 September 2026 while their fields are laid out up to three across. The fix removes that width from the two pages (commit `76469876`), and pairs up a few half-empty rows (commit `f6a62977`): Email beside Phone, three fields across for the event row and the three tick boxes from 1024 pixels. Nothing about fields, validation or saving changed. Before and after screenshots are in `tasks/previews/pb-form-2026-10-13/`. Around twenty other pages use the same narrow width; they were not touched.

## 8. Known gaps and limits

Not built, by decision or because it needs a decision:

- **No gate on unsigned documents.** A booking can be confirmed, and an event can go ahead, with the contract or food agreement unsigned. The event sheet shows a blocker for the food agreement; nothing blocks on the contract. No report lists unsigned documents other than `/signatures`.
- **No way to record a paper or written acceptance.** The contract says it can be accepted by signing, by paying the deposit or by written confirmation. Only the first two are recorded. Staff can still mark a food agreement signed by hand or upload a signed one; doing so withdraws an open request.
- **Staff can change a food agreement's status by hand** after it was signed electronically. The change is audited but not prevented.
- **The onboarding checklist's "agreement accepted" tick** can also be set by hand, and its label on the new-employee form refers to the staff handbook and rules while the checklist calls it the employee agreement.
- **The worker agreement names a fixed issuing manager** in its text, while the electronic signature for the business is whoever pressed send.
- **Deposit deduction agreements and unpaid trial shifts** are not signing kinds. A deposit deduction is agreed in a staff note.
- **Job offers:** the existing "Make Offer" email and the new signed job offer overlap. A signed offer does not move the application on.
- **A signed supplier confirmation** does not change the supplier's status on the booking.
- **Wording.** The food agreement still calls itself an "optional annex" and its footer says "Waiver". The Young Worker Schedule still carries an internal-use note. The quote still says to accept by email or phone, with the online panel added beside it. None of this wording was changed, on purpose.
- **Food agreement status can lag.** If the first link email fails and a later "Send New Link" succeeds, the booking still reads "required" (not "sent") until it is signed. The signing panel shows the true state of the request.
- **A food agreement request can outlive the tick in one case.** If "Outside food" is unticked but the save's reconcile step failed, the stored status stays "sent" and the request stays open. The failure is logged.
- **A failed contract email still uses a version number.** The contract version is increased and a copy stored before the email is attempted, as before this work. The next send is simply the next version.
- **Email subject with no date.** The contract email subject for a booking with no date reads "... on Date to be confirmed". Existing wording, not changed.
- **Device description.** An iPhone is described as "Safari on macOS (mobile)" on the signing record, from a shared user agent parser. The raw user agent string is stored correctly.
- **Location** is approximate and comes from the hosting platform. A VPN or mobile network can place a signer in another town. It is supporting evidence, not proof.
- **Identity.** For customers, clients, suppliers and candidates the only proof of identity is control of the email address the link was sent to. Only new starters have a second check (date of birth).
- **No SMS and no postal fallback.** A signer with no email address signs in person.
- **Seven year retention** is a rule, not a mechanism. Nothing purges and nothing prevents a manual deletion with the service role.
- **Templates.** All twelve seeded templates are switched off and contain gaps for the owner to complete. None has been sent.
- **Quotes.** Separately from signing, the Quotes pages filter on a column the live table does not have and very likely fail in production (there are no quotes yet). Raised as its own task.
- **Contract wording.** Separately, the contract names the business "The Anchor Pub" in five places against the brand rule. Raised as its own task.

## 9. Verification

### 9.1 First release (live)

- Before release: lint, both typechecks, the full test suite in London and in UTC, the build, and a real Postgres harness for the two database functions and the append-only trigger (`scripts/testing/document-signing-postgres.py`).
- After release, signed out, on the live site: an unknown link shows the neutral page; the four public endpoints answer 404 with no caching; the daily job answers 401 without its secret; staff pages redirect to login.
- On 13 October 2026 the owner sent and signed a real booking contract by link on production. The trail shows opened, viewed, signed, the IP address and "Staines, ENG, GB", the signed copy built, copies sent and the booking marked accepted.

### 9.2 Follow-up (local, three commits on `fix/signing-live-test-followups`)

Commits: `1d0d1c12` (deposit no longer overwrites an acceptance), `59394f7d` (lesson recorded), `66dedebb` (everything else in section 6). 65 files, about 8,200 lines added, of which about 6,600 are tests. `main` has not moved since the branch was cut.

Run on the final code, all passing:

| Check | Result |
|---|---|
| `npm run lint` | pass, no warnings |
| `npx tsc --noEmit` | pass |
| `npm run typecheck:tests` | pass |
| `npm run test:coverage` (London) | 1,294 files, 13,999 tests passed, 2 skipped. Coverage: lines 64.75, branches 53.95, functions 66.69 (floors 42, 34, 52) |
| `npm run test:utc` | 1,294 files, 13,999 tests passed, 2 skipped |
| `npm run build` with the CI settings | pass |
| `npm run test:pg` (ten real Postgres harnesses) | pass |

New and changed tests: about 500 cases in 23 files. They cover the food agreement rule, the reconcile step and its callers, the page split and its refusals, the two-request send and its failure paths, the two-button email (rendered with fixture data and checked for `undefined`, `Invalid Date` and `NaN`), the signature places in each real template, the second render at finishing, automatic withdrawal for every record type, the deposit fix, and the signing screens.

Real render: the real templates were rendered through real Chromium with made-up people, before and after signing, for the contract with and without a food agreement, the food agreement alone, the worker agreement for an adult and for an under 18, a policy and a quote. Every fixed A4 sheet was measured in the browser and none overflows, with long names. Each signature page was read by eye. The samples are in `tasks/previews/signing-2026-10-13/`.

### 9.3 Not verified

- Nothing in the follow-up has run on production or in a signed-in browser.
- The two-button email has not been received in a real inbox.
- The second render has not run on Vercel, which uses a different Chromium build from a developer's machine. Fonts and page breaks there are unproven for the follow-up. The first render path is proven on Vercel by the owner's test.
- Signing in the staff portal and signing in person have never been used on production. Only signing by link has.
- The daily job's runs on production have not been inspected.
- No template kind has been sent, because all twelve are switched off.
- The layout fix was measured in a local harness with made-up data, in Chromium only. It has not been seen on the signed-in live page, in Safari or on an iPad.

### 9.4 Booking form layout (two commits on `fix/private-booking-form-desktop-layout`)

Commits `76469876` and `f6a62977`. Lint, both typechecks, the full suite in London and UTC (1,279 files, 13,501 tests) and the build all pass.

## 10. Where a reviewer should push hardest

1. **Legal sufficiency.** Whether a typed name, a tick and this evidence is adequate for each of the twelve kinds under UK law, in particular the worker agreement (a written statement of particulars), the 48 hour opt-out, wage deduction consent, and consent given by a parent or guardian identified only by an email address the worker's manager typed in.
2. **The signed copy is rendered a second time.** The fingerprint is of the first render; the signed copy is a second render of stored HTML with only the signature places changed. Check that claim holds: `src/lib/signing/service.ts` (`finaliseSigningDocument`), `signature-slots.ts`, `render.ts`. Consider whether fonts, the time of rendering or the browser version could change anything else, and whether the record page's wording describes this fairly.
3. **Dividing one render into two documents by page count.** `documents/booking-contract.ts` and `selectPdfPages`. The guard is the expected page total. Look for a way to get the wrong pages in front of a signer.
4. **Token handling.** Generation, hashing, expiry, reissue on reminder, the in-person session, the throttle, and whether any path logs or stores a usable link (`tokens.ts`, `public-request.ts`, `emails.ts`, the email log redaction).
5. **The date of birth check.** Lockout, enumeration, and what a locked signer can still do.
6. **Automatic withdrawal.** `subject-state.ts` decides that a record no longer needs signing. A wrong "closed" withdraws a real request; a wrong "open" lets someone sign a cancelled booking. Check each rule, and what happens on a database error.
7. **Concurrency in finishing.** Two last signatures at once, a signature during the daily job, a download during finishing. The claims are `final_pdf_path`, `copies_sent_at`, `completion_applied_at`.
8. **Completion hooks.** Each writes to a live business record. Check they cannot overwrite a newer state (a contract version that has moved on, a quote whose total changed, an acceptance already made by payment).
9. **Access.** That nothing reaches the four tables or the bucket without the service role and a prior permission check, and that view and send permissions per kind are the right ones. Policy acknowledgements are visible with `employees` `view`, the others need `view_documents`.
10. **Personal data.** IP address, location, device and date of birth checks are stored for seven years. Whether the privacy notice covers this and whether less would do.
11. **The food agreement rule.** Whether "tick or package" is the whole rule, and whether a booking can still reach its event with outside food and no signed agreement without anyone being told.
12. **Email as the only channel.** What a customer sees if the email is delayed or filtered, and whether one email with two buttons is clear enough that both get signed.

## 11. Independent review of revision 1, and what was done

A read-only review on 13 October 2026 checked the first release, the follow-up code, the live database and the deployed endpoints. It confirmed the live state described in section 1 and found the faults below. All fixes are in the follow-up branch; none is live until that branch is released. Items marked "live today" exist in the first release, so releasing the follow-up fixes them on the live site too.

### 11.1 High priority

| Finding | Live today | What was done |
|---|---|---|
| A signed-copy email that fails is never sent again | Yes | Each delivery is written to the trail. A copy the provider definitely refused is tried again by the daily job for three days, or for as long as email is switched off. A copy whose outcome is not known is recorded as such and never sent again automatically. The alert names who is still waiting. |
| A failed reminder kills the working link and uses up a reminder | Yes | The new link replaces only the link that was read, so two sends cannot clash. If the provider refuses the email the earlier link is put back and the reminder is not counted. If the outcome is not known the new link stays and the reminder is counted, so it is not sent again every morning. |
| The signed file is not checked against its fingerprint before download or email | Yes | It is now checked on every download and before every email. The stored HTML that the signed copy is rendered from has its own fingerprint, checked before use. |
| Cancellation and signing are separate operations | Yes | The contract and food agreement hooks no longer write to a cancelled booking, in the same statement as the update. A request is withdrawn when its booking is cancelled (section 6.4). The check before the signature and the signature itself are still two database calls; closing that last gap needs the check inside the database function, which is a migration and is listed in 11.4. |
| Reconciling the food agreement can overwrite a signature made at the same moment | No (follow-up) | The status is changed only if it is still the status that was read. The tick correction is a separate write. |

### 11.2 Further fixes and claim corrections

| Finding | What was done |
|---|---|
| The sender gets a notice, not the signed PDF, and its failure was ignored | Section 4.3 corrected. The notice's failure is now reported, and it is only recorded as sent when it went. |
| Staff downloads do not retry every unfinished step | A download now finishes whichever step is unfinished. A failure there raises an alert and the signed copy is still handed over. |
| Completion hooks can run twice; the checklist date was the processing time | The contract acceptance time and the checklist date now use the time of signing. A duplicate candidate note remains possible if two callers run together (11.4). |
| A failed audit insert was never recovered; an error marking older versions as replaced was ignored | If the audit row cannot be written the change is put back and the hook fails, so the retry does both. The replace error now stops the step. |
| The second render cannot guarantee that only the signature panels change | Section 6.3 corrected. A render that would cut text off a fixed page is now refused, when sending and when making the signed copy. If the second render cannot be trusted (overflow, a different page count, a source that fails its fingerprint) the signed copy is the file each signer was shown plus the record page, and an alert is raised. Fonts are still loaded from Google at render time (11.4). |
| Throttling is weaker than described | Section 4.8 corrected. The throttle is shared with other public pages and is not changed here (11.4). |
| A dead link is not treated like an unknown link | Section 4.8 corrected. Behaviour unchanged: a recognised link that has expired or been withdrawn says so, and shows the document title and the recipient's name to whoever holds it. |

### 11.3 Edge cases

| Case | What was done |
|---|---|
| Two resends at the same moment | The second is refused and sends nothing. |
| A reissued link keeps the earlier identity check and document opening | A new link clears both, so its holder repeats them. An in-person session clears the document opening. |
| A replaced link used by a request already in flight | A signature by link is refused if the link has been replaced since the page was opened. The check and the signature are still two calls (11.4). |
| A quote's wording changes while its total does not | A fingerprint of the quote's lines, notes, dates and figures is taken when it is sent. The quote is only marked accepted if it still matches. |
| A template edited and switched on at the same moment | Switching on is refused unless the version is the one that was on screen and the one that was checked. |
| Withdrawal and expiry write the status and the trail separately | A failed trail write raises an alert, and the daily job adds the missing line for anything closed in the last 14 days. |

### 11.4 Not fixed, and why

- **The last gap between checking and signing.** Making the record check, the link check and the signature one transaction needs the check inside `signing_record_signature`, which is a database migration. Today the window is the few milliseconds between two calls, and the hooks do not write to a cancelled booking in any case.
- **Fonts.** The contract and worker agreement load fonts from Google when rendered. Embedding them removes a dependency from both renders. Not done here.
- **The shared throttle.** One allowance per link and address together, with a counter that is not atomic. It is used by other public pages, so it is a separate change.
- **Duplicate candidate note.** Possible only if two callers finish the same job offer in the same instant.
- **A page that overflows outside signing.** The plain contract download and preview still cut off text that does not fit, as they always have. Only documents sent for signature refuse.
- **Still outstanding from revision 1:** the unsigned-document warning, recording a paper acceptance, the retention mechanism, and the untested portal, in-person, inbox and Vercel render paths. The first two are approved and being built next.

