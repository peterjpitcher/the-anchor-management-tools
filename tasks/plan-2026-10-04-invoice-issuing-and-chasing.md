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

Data fixes, not done, owner's yes needed, only after R0.1, R0.2 and R0.5 are confirmed live:
- [ ] Restore the email on the four private hire client records from the booking contact email. Exact ids listed and checked before and after.
- [ ] Backfill `sent_at` and `sent_to` on INV-003WD and INV-003WV from their email log rows.

## R1a. Sender switch (pull request 2)

- [x] `INVOICE_EMAIL_PROVIDER=graph` pins the provider in one helper used by `sendInvoiceEmail`, the statement send, the private booking receipt and the payment link email
- [x] Copied addresses checked against the block list; proposed, dropped and sent recipients recorded in the email's metadata
- [x] `.env.example` documents the switch and corrects the mistyped mobile
- [ ] Owner: test email, then set the switch in Vercel

## R1b. One voice (pull request 2)

- [x] `src/lib/invoices/email-copy.ts`: sign-off, greeting helper, every default wording, kind labels
- [x] `resolveInvoiceGreeting` on the server (primary contact, else guest record, else "there")
- [x] Wire into: manual send and chase dialogs, monthly billing job, recurring job, private hire invoice and extras, receipts, payment page greeting, private booking receipt
- [x] Pay online line becomes a P.S.; receipts carry none
- [x] Retire the separate payment link email; button becomes "Resend invoice"; no WhatsApp wording
- [x] Fixture render test over the full set in the spec, in both time zones

## R2. Reminders (pull request 2)

- [x] Migration written, not applied: `invoices.reminders_held_until`, `reminder_first_sent_at`, `reminder_second_sent_at`, and `cron_job_runs.result`
- [x] Pure rules module with tests (windows, skips, forecast, working days)
- [x] New reminder job: off without the go-live date; durable stage record; claim per stage; accepted, refused and unknown outcomes; recheck before each send
- [x] Daily summary with saved state on the run record
- [x] Hold and Resume on the invoice page, server-checked
- [x] `vercel.json`: `30 9 * * 1-5`
- [ ] Owner: apply the migration to production (prod-migrate), approve the first run's list, set `INVOICE_REMINDERS_GO_LIVE_DATE`

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

1. Deploy pull request 1. Confirm on the production deployment: the reminder job ran and emailed no customer; the owner alert arrived; `auto-send-invoices` returns 404; the GitHub workflows no longer list the two jobs.
2. Apply the two data fixes.
3. Apply the R2 migration to production (`supabase/migrations/20261004180000_invoice_reminder_columns.sql`). Then deploy pull request 2. Deploying it first breaks the invoice page's hold control and email history.
4. Test email through the mailbox route. Check the From name, Sent Items, a reply, and a copied address. Then set `INVOICE_EMAIL_PROVIDER=graph` and redeploy.
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

**Not done, by design.** Nothing was deployed. The migration was not applied. No email was sent, including the R1a test email. The two data fixes were not applied. No screen was opened in a signed-in browser, so the hold control, the Emails panel, the receipt tick and the reworded dialogs are proven by component tests only. The reminder job's go-live preview was not run against production.
