# Plan: invoice issuing and chasing

**Date:** 4 October 2026
**Spec:** `tasks/spec-2026-10-04-invoice-issuing-and-chasing.md` (version 4)
**Review folded in:** `docs/reviews/2026-10-04-invoice-issuing-and-chasing-developer-review.md`
**Built from:** `origin/main` at `a33b4746`, in the worktree `.claude/worktrees/invoice-email`. The primary folder's `main` was 65 commits behind and holds another session's work, so nothing is built there.

## How it is split

Two pull requests, so the urgent part can go live alone.

| Pull request | Branch | Contains | Needs before it can go live |
|---|---|---|---|
| 1 | `fix/invoice-r0-stop-the-harm` | R0 | Owner's yes to deploy |
| 2 | `feat/invoice-email-personal` (on top of 1) | R1a, R1b, R2, R3, R4, R5 | Pull request 1 live. The R2 migration applied to production first. Owner's yes to deploy |

Pull request 2 changes nothing a customer receives until the owner sets a switch, with three exceptions that take effect on deploy: the new wording of emails staff send by hand and of the monthly and recurring invoice emails, the weekday morning timing of those two jobs, and the receipt tick on Record Payment.

## Assumptions recorded for the commits

- The owner approved building on 4 October 2026 ("implement everything in full"). Deploying, the production migration, the two data fixes and the R1a test email were not approved and are not done.
- The recommended answers in the spec's Assumptions section stand, since no other answer was given.
- New environment variables are optional feature switches. Unset means off.

## R0. Stop the harm (pull request 1)

- [x] R0.1 Reminder job emails no customer; owner alert by the ordinary email route with truthful wording (`src/app/api/cron/invoice-reminders/route.ts`)
- [x] R0.2 `VendorService.updateVendor` stops writing `email` and `contact_name` (`src/services/vendors.ts`, `src/app/actions/vendors.ts`), with a test
- [x] R0.3 Recurring job marks an invoice sent only after the email succeeds, records `sent_at` and `sent_to`, and every failure exit keeps the draft and raises an alert linking to it (`src/app/api/cron/recurring-invoices/route.ts`), with tests
- [x] R0.4 Delete `.github/workflows/invoice-reminders.yml`; remove `invoice-reminders` and `auto-send-invoices` from `.github/workflows/cron-jobs.yml`
- [x] R0.5 Remove `/api/cron/auto-send-invoices`, its `vercel.json` entry and its test references
- [x] R0.6 Delete `scripts/trigger-invoice-reminders.ts`, `src/lib/invoice-reminder-safety.ts` and the tests that pin them
- [x] R0.7 Remove the non-existent `email_type` field from the chase log insert; the "recent reminder" warning ignores owner alerts (`src/app/actions/email.ts`, `src/components/modals/ChasePaymentModal.tsx`)
- [x] Gates: lint, typecheck, typecheck:tests, tests in both time zones, build

Data fixes, applied on 4 October 2026 with the owner's yes, after R0.1, R0.2 and R0.5 were confirmed live (see Results):
- [x] Restore the email on the four private hire client records from the booking contact email. Exact ids listed and checked before and after.
- [x] Backfill `sent_at` and `sent_to` on INV-003WD and INV-003WV from their email log rows.

## R1a. Sender switch (pull request 2)

- [x] `INVOICE_EMAIL_PROVIDER=graph` pins the provider in one helper used by `sendInvoiceEmail`, the statement send, the private booking receipt and the payment link email
- [x] Copied addresses checked against the block list; proposed, dropped and sent recipients recorded in the email's metadata
- [x] `.env.example` documents the switch and corrects the mistyped mobile
- [x] Test email sent and checked on 4 October 2026 (see Results)
- [ ] Owner: the From name is confirmed fine (4 October 2026). Still to do: press Reply on the second test email (see Results) and check it addresses the Orange Jelly mailbox, then set the switch in Vercel and redeploy

## R1b. One voice (pull request 2)

- [x] `src/lib/invoices/email-copy.ts`: sign-off, greeting helper, every default wording, kind labels
- [x] `resolveInvoiceGreeting` on the server (primary contact, else guest record, else "there")
- [x] Wire into: manual send and chase dialogs, monthly billing job, recurring job, private hire invoice and extras, receipts, payment page greeting, private booking receipt
- [x] Pay online line becomes a P.S.; receipts carry none
- [x] Retire the separate payment link email; button becomes "Resend invoice"; no WhatsApp wording
- [x] Fixture render test over the full set in the spec, in both time zones

## R2. Reminders (pull request 2)

- [x] Migration: `invoices.reminders_held_until`, `reminder_first_sent_at`, `reminder_second_sent_at`, and `cron_job_runs.result`. Applied to production on 4 October 2026 with the owner's approval (see Results)
- [x] Pure rules module with tests (windows, skips, forecast, working days)
- [x] New reminder job: off without the go-live date; durable stage record; claim per stage; accepted, refused and unknown outcomes; recheck before each send
- [x] Daily summary with saved state on the run record
- [x] Hold and Resume on the invoice page, server-checked
- [x] `vercel.json`: `30 9 * * 1-5`
- [ ] Owner: approve the first run's list, then set `INVOICE_REMINDERS_GO_LIVE_DATE`

## R3. Email history (pull request 2)

- [x] Server action with view permission, admin client, escaped text
- [x] Emails panel and the "next reminder" line on the invoice page
- [x] Chase dialog warning reads the same data; dialogs show server warnings

## R4. Weekday issuing (pull request 2)

- [x] Recurring job: `0 9 * * 1-5`; invoice dated the day it is raised; schedule advances from its own date
- [x] Monthly billing job: `5 9 * * 1-5`; per-month pass record; completes an interrupted pass in the first seven days; alert on the eighth

## R5. Close the loop (pull request 2)

- [x] Receipt sender as a server-only module on the admin client
- [x] PayPal receipts sent by the sweep in the 15 minute check (the only sender); off without `INVOICE_PAYPAL_RECEIPTS_FROM`
- [x] Receipt tick on Record Payment, enforced on the server
- [x] PDF Terms box and online payment line

## Release checklist (for the owner, in order)

1. DONE 4 October 2026. Deploy pull request 1. Confirm on the production deployment: the reminder job ran and emailed no customer; the owner alert arrived; `auto-send-invoices` returns 404; the GitHub workflows no longer list the two jobs.
2. DONE 4 October 2026. Apply the two data fixes.
3. DONE 4 October 2026. Apply the R2 migration to production (`supabase/migrations/20261004185059_invoice_reminder_columns.sql`). Then deploy pull request 2. Deploying it first breaks the invoice page's hold control and email history.
4. PART DONE 4 October 2026: sent and found in Sent Items, From name confirmed by the owner. Still open: the owner's Reply check on the second test (see Results). Test email through the mailbox route. Check the From name, Sent Items, a reply, and a copied address. Then set `INVOICE_EMAIL_PROVIDER=graph` and redeploy.
5. Add contact names for the two clients greeted "Hi there"; fix the refused address at Barons Pubs.
6. Review the first reminder run's list: call the reminder route with `?preview=true&go_live=YYYY-MM-DD` (it sends and changes nothing). Then set `INVOICE_REMINDERS_GO_LIVE_DATE` and redeploy.
7. Set `INVOICE_PAYPAL_RECEIPTS_FROM` to the day it is switched on (an earlier date sends late receipts), and redeploy.
   Before any switch: confirm `CRON_ALERT_EMAIL` is set in production and reaches the owner. It is the only route for "outcome unknown" and "raised but not emailed" alerts.

Each switch is an environment variable. On Vercel a changed variable only reaches a new deployment.
8. After two weeks: compare a few received emails with the approved wording, count clients still greeted "Hi there", and check no send failures are outstanding.

Rollback keeps reminders paused. It never restores the old automatic reminders.

## Results

**R0 (pull request 1), 4 October 2026.** Run on the committed branch in a clean worktree:
- `npm run lint`: clean.
- `npx tsc --noEmit`: clean. `npm run typecheck:tests`: clean.
- `npm test` (Europe/London): 1,217 files, 12,315 tests passed, 2 skipped.
- `npm run test:utc`: 1,217 files, 12,315 tests passed, 2 skipped.
- `npm run build`: compiled, 144 static pages generated.
- Not done: nothing was run against production and no screen was opened in a browser. The
  reminder job's new behaviour is proven by its test (one email, to the owner, with the new
  wording), not by a live run.
- The two data fixes are written in `tasks/data-fixes-2026-10-04-invoice-r0.sql` with their
  before and after checks. The source rows were checked read-only against production: four
  client records, each with one booking and one contact email that matches where its invoices
  were sent; INV-003WD emailed 1 September 2026 and INV-003WV emailed 1 October 2026, one log
  row each.

**R0, later the same day.** One more commit on the R0 branch: alert emails no longer mangle record links and dates as phone numbers. R0.3's alert relies on that link to point at the exact draft. Its tests pass in both time zones.

**R1 to R5 (pull request 2), 4 October 2026.** Run on the final committed branch:
- `npm run lint`: clean.
- `npx tsc --noEmit`: clean. `npm run typecheck:tests`: clean.
- `npm test` (Europe/London): 1,238 files, 12,895 tests passed, 2 skipped.
- `npm run test:utc`: 1,238 files, 12,895 tests passed, 2 skipped.
- `npm run build`: compiled, 144 static pages generated.
- The last change after the test runs was a one-line type annotation; both type checks, lint and the build were re-run after it.

**Independent review.** Two reviewers read the sending, payment and screen code against the spec before it was pushed. They confirmed that nothing can email a customer while the three switches are off. They found fifteen faults. Thirteen are fixed, with tests, in the commit "act on the independent review before anything is switched on". The hold control is still not shown on a draft (a draft gets no reminders). The PDF's "or to arrange card payment" wording was removed afterwards, on the owner's decision. What was accepted rather than fixed is in the spec under "As built", "Known and accepted".

**Not done, by design (as it stood when the build finished; the entries below record what was released afterwards).** Nothing was deployed. The migration was not applied. No email was sent, including the R1a test email. The two data fixes were not applied. No screen was opened in a signed-in browser, so the hold control, the Emails panel, the receipt tick and the reworded dialogs are proven by component tests only. The reminder job's go-live preview was not run against production.

**R1a test email, 4 October 2026, 18:38 UTC (owner approved).** One email, marked as a test and on made-up figures, was sent through the Orange Jelly mailbox by Microsoft Graph to the owner's own address, copied to the mailbox itself, with a PDF attached.
- Microsoft accepted it (`success: true`), and the app saved its record (from the mailbox's address, not the no-reply one).
- Checked in the mailbox: the copy is in Sent Items, and the copied message arrived in the Inbox three seconds later, with its attachment.
- Still for the owner to check, in the copy that reached his own address: the name shown in the From line, and that pressing reply addresses the Orange Jelly mailbox.
- So the mailbox route works today. `INVOICE_EMAIL_PROVIDER=graph` can be set once pull request 2 is live.

**R0 merged, 4 October 2026, 18:46 UTC.** Pull request 177 merged to main as `42183ec6` after its CI passed (lint, type checks, tests, build, database contract, Postgres harnesses).

**Migration applied to production, 4 October 2026, 18:50 UTC (owner approved the exact SQL and checksum).**
- Project `the-anchor-management-tools`, ref `tfcasgxopxegwrabvwat`.
- File checksum (SHA-256) `9dfa63ccea73664a9af5baa6855ceb00fbf0f9a89068e34c13b12001987563dd`, unchanged between approval and apply.
- Applied through the Supabase migration tool. Production recorded it as version `20261004185059`, name `invoice_reminder_columns`. The repo file was written as `20261004180000_...` and has been renamed to `20261004185059_invoice_reminder_columns.sql` so the repo matches production's history. Its contents are unchanged.
- Checked afterwards: the four columns exist, nullable, with no default; all 72 invoices have the three new columns empty; all job run rows have `result` empty; the two views that read `invoices` are still defined; a test write to `cron_job_runs.result` on a dedicated row worked and was rolled back.
- Tested beforehand on a throwaway local database: applied cleanly, a second run changed nothing, and the rollback removed the columns.
- Rollback, if ever needed: drop the four columns (`reminders_held_until`, `reminder_first_sent_at`, `reminder_second_sent_at` on `invoices`; `result` on `cron_job_runs`).

**Data fixes applied to production, 4 October 2026, 18:53 UTC (owner approved).** Run from `tasks/data-fixes-2026-10-04-invoice-r0.sql` once R0 was confirmed live on deployment `dpl_13oUNALBe4qioAL12muJg2ZfEmi4` (the reminder job answered with no customer email sent, and the removed auto-send route answered 404).
- Fix 1: four private hire client records had their email restored from their own booking's contact email. Read back afterwards: four of four have an address.
- Fix 2: INV-003WD and INV-003WV now carry the date and address they were really emailed to (1 September and 1 October 2026). Read back afterwards: both are `sent`, with `sent_at` and `sent_to` filled.
- Both rows of evidence carry the same change time (18:53:14 UTC), so the two fixes went in together. Read back afterwards: 4 client records and 2 invoices changed, as expected.

**Owner's feedback on the first test email, and a second test, 4 October 2026.** The From name was fine. Pressing Reply addressed the owner's own outlook.com address, not the Orange Jelly mailbox.
- Not proven, but the likely cause is the test's own design: it was copied to the sending mailbox, so there were copies in that mailbox's Sent Items and Inbox, and replying to a message you sent addresses the person you sent it to.
- The code sets the reply address on every invoice email sent through the mailbox (`invoiceReplyToAddress()`, the mailbox itself unless `INVOICE_EMAIL_REPLY_TO` says otherwise), and a reply to an email that is From the mailbox goes to the mailbox in any case.
- A second test went at 19:01 UTC to the owner's outlook.com address only, with no copies. Microsoft accepted it and the app saved its record. Read back from Sent Items: from Peter Pitcher at the Orange Jelly mailbox, one recipient, nobody copied, PDF attached.
- The header itself could not be read back: the app's permission on the mailbox can send but not read, and the mailbox view available does not show the reply address. So the reply address is confirmed in code and by the route, and still needs the owner to press Reply on that single copy.

**Payment link check (owner asked), 4 October 2026.** A pay online link is offered only to a client with PayPal payments switched on, and only while a balance is due.
- One rule, `invoiceCanOfferPayPal` (`src/lib/invoices/email-drafts.ts`), decides it. Everything that can produce a link goes through it: the P.S. on every invoice, reminder and chase email, the note in the two send dialogs, the "Pay online" line on the PDF, the private hire balance email, the staff "copy link" action, and the payment page itself, which refuses a client without it.
- Production: the setting cannot be empty and is off unless switched on. 4 of the 13 client records have it on.
- The test emails showed the P.S. on purpose, with a made-up link, to show how it reads. That was not clear and prompted the question.

**R1 to R5 merged and live, 4 October 2026.** Pull request 178 merged to main as `25bc5ec6` after its CI passed (lint, type checks, tests, build, database contract, Postgres harnesses). Production deployment `dpl_7TRJAuD1J7Fyx7BkUJnhLRiVaNHV`, ready at 19:33 UTC.
- Checked on the live site: the reminder preview answers and says nothing was sent or changed (asked with a go-live date of 5 October 2026: no invoice would be emailed, and five overdue invoices are listed for the owner to chase by hand, INV-003W8, INV-003WN, INV-003WG, INV-003WD and INV-003WT); a preview with a date that does not exist is refused (400); a mistyped preview query is refused (400) and does not start a run; the route refuses a call with no secret (401); the removed auto-send route still answers 404.
- The three switches are still off, so no new customer email has started. Invoice emails keep leaving by the old route, with the new wording, until `INVOICE_EMAIL_PROVIDER=graph` is set.
- Not checked: the new screens in a signed-in browser (hold control, Emails panel, receipt tick, reworded dialogs). That is the owner's check.
