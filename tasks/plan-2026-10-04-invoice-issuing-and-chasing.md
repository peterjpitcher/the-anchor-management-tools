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

- [ ] `INVOICE_EMAIL_PROVIDER=graph` pins the provider in one helper used by `sendInvoiceEmail`, the statement send, the private booking receipt and the payment link email
- [ ] Copied addresses checked against the block list; proposed, dropped and sent recipients recorded in the email's metadata
- [ ] `.env.example` documents the switch and corrects the mistyped mobile
- [ ] Owner: test email, then set the switch in Vercel

## R1b. One voice (pull request 2)

- [ ] `src/lib/invoices/email-copy.ts`: sign-off, greeting helper, every default wording, kind labels
- [ ] `resolveInvoiceGreeting` on the server (primary contact, else guest record, else "there")
- [ ] Wire into: manual send and chase dialogs, monthly billing job, recurring job, private hire invoice and extras, receipts, payment page greeting, private booking receipt
- [ ] Pay online line becomes a P.S.; receipts carry none
- [ ] Retire the separate payment link email; button becomes "Resend invoice"; no WhatsApp wording
- [ ] Fixture render test over the full set in the spec, in both time zones

## R2. Reminders (pull request 2)

- [ ] Migration: `invoices.reminders_held_until`, `reminder_first_sent_at`, `reminder_second_sent_at`
- [ ] Pure rules module with tests (windows, skips, forecast, working days)
- [ ] New reminder job: off without the go-live date; durable stage record; claim per stage; accepted, refused and unknown outcomes; recheck before each send
- [ ] Daily summary with saved state on the run record
- [ ] Hold and Resume on the invoice page, server-checked
- [ ] `vercel.json`: `30 9 * * 1-5`
- [ ] Owner: apply the migration to production (prod-migrate), approve the first run's list, set `INVOICE_REMINDERS_GO_LIVE_DATE`

## R3. Email history (pull request 2)

- [ ] Server action with view permission, admin client, escaped text
- [ ] Emails panel and the "next reminder" line on the invoice page
- [ ] Chase dialog warning reads the same data; dialogs show server warnings

## R4. Weekday issuing (pull request 2)

- [ ] Recurring job: `0 9 * * 1-5`; invoice dated the day it is raised; schedule advances from its own date
- [ ] Monthly billing job: `5 9 * * 1-5`; per-month pass record; completes an interrupted pass in the first seven days; alert on the eighth

## R5. Close the loop (pull request 2)

- [ ] Receipt sender as a server-only module on the admin client
- [ ] PayPal receipt after capture, plus the sweep in the 15 minute check; off without `INVOICE_PAYPAL_RECEIPTS_FROM`
- [ ] Receipt tick on Record Payment, enforced on the server
- [ ] PDF Terms box and online payment line

## Release checklist (for the owner, in order)

1. Deploy pull request 1. Confirm on the production deployment: the reminder job ran and emailed no customer; the owner alert arrived; `auto-send-invoices` returns 404; the GitHub workflows no longer list the two jobs.
2. Apply the two data fixes.
3. Apply the R2 migration to production. Then deploy pull request 2.
4. Test email through the mailbox route. Check the From name, Sent Items, a reply, and a copied address. Then set `INVOICE_EMAIL_PROVIDER=graph`.
5. Add contact names for the two clients greeted "Hi there"; fix the refused address at Barons Pubs.
6. Review the first reminder run's list. Then set `INVOICE_REMINDERS_GO_LIVE_DATE`.
7. Set `INVOICE_PAYPAL_RECEIPTS_FROM` when ready.
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
