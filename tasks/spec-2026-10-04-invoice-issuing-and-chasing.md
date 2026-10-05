# Spec: invoice issuing and chasing, email only and personal

**Date:** 4 October 2026
**Status:** Version 4, built and live on 4 October 2026 (pull requests 177 and 178, production deployment `dpl_7TRJAuD1J7Fyx7BkUJnhLRiVaNHV`). The three switches were turned on on 5 October 2026 (go-live date for reminders: 5 October 2026). Approved to build by the owner on 4 October 2026. The developer review of the same date (`docs/reviews/2026-10-04-invoice-issuing-and-chasing-developer-review.md`) is folded in; the table near the end says what changed for each finding. The plan is `tasks/plan-2026-10-04-invoice-issuing-and-chasing.md`; its Results section records what was released and checked.
**Goal (owner's words):** "Everything should be over email and should feel personal."
**Scope:** every email that issues, chases or acknowledges an Orange Jelly invoice, and the screens staff use to send and follow them.
**Paired repository:** no change needed in the website repo. It does not read invoices.

## Summary

**Email only: already true for invoices.** No invoice, reminder or receipt has ever gone by text or WhatsApp. The only texts that chase money are private hire deposit and balance reminders (a fallback when a guest has no email) and parking and event ticket payments. None of those is an invoice, and they are left to a separate spec.

**Personal: not yet.**
- Every invoice email since 25 June 2026 has left from `noreply@auth.orangejelly.co.uk`, not from the Orange Jelly mailbox. That was a side effect of the communications logging change (`3e96016b`, 22 June), not a decision.
- No email has ever greeted a person by first name. The automatic ones say "Dear Golden Barrels Limited".
- There are about fifteen wordings, several different sign-offs and three phone numbers.
- Automatic reminders read like a collections system ("Final Reminder", "to avoid any disruption to services"), 22 of 71 went at a weekend, and none can be paused.
- Monthly invoices are emailed at about 2am, weekends included.
- Staff cannot see what was sent for an invoice or what will go next.

**Live faults found on the way.**
- Recurring invoices are sent but never chased. One client holds £7,560 on three invoices, and two of those will never get a reminder as things stand.
- Saving a client on the Vendors page wipes its email and contact name. Nine of the fourteen client records are blank today, and the audit log ties seven of them to a save on that page.
- The reminder job is triggered by three schedulers, two of them hours late.

**The change:** one sender, one voice, one schedule, one history. Seven small releases, most urgent first. Anything that would start sending customers something new stays switched off until the owner turns it on (see "Release switches").

**Deadline:** unless R0.1 is live before 10:00 London time on Thursday 8 October, the current job sends four customer emails that morning: a "Final Reminder" with the "disruption to services" line, a "First Reminder" to a private hire customer a week before their event, and two "Payment Due Today" emails. The Final Reminder and one of the Due Today emails go to the same person, seconds apart.

## Release switches

Building this does not start any new customer email. Three switches are off until the owner sets them, and each fails closed: missing or mistyped means off.

| Switch (environment variable) | Off (unset) | On |
|---|---|---|
| `INVOICE_EMAIL_PROVIDER=graph` | Invoice emails keep leaving as they do today | Invoice emails leave from the Orange Jelly mailbox (R1a) |
| `INVOICE_REMINDERS_GO_LIVE_DATE=YYYY-MM-DD` | The reminder job emails no customer. The owner still gets his summary | Invoices falling due on or after that date get the two automatic reminders (R2) |
| `INVOICE_PAYPAL_RECEIPTS_FROM=YYYY-MM-DD` | PayPal payments send no receipt, as today | PayPal payments recorded on or after that date send a receipt (R5) |

Four steps stay with the owner whatever is built, and none is taken without his explicit yes: a deployment to production, the production migration for R2, the two data fixes in R0, and the test email in R1a.

On Vercel a changed environment variable only reaches a new deployment, so each switch needs a redeploy after it is set.

## What happens today

| Message | Trigger | Seen by a person first? | Wording |
|---|---|---|---|
| Invoice, sent by hand | Email Invoice button | Yes, editable | "Hi {company}, I hope you're doing well!", signed Peter Pitcher with mobile |
| Invoice, monthly billing run | 01:05 UTC on the 1st, any day of the week | No | Three lines, signed "Peter", no amount or due date |
| Invoice, recurring schedule | 01:00 UTC daily | No | "Dear {company}", "generated automatically", signed by the company |
| Invoice, auto-send of drafts dated today | 07:00 UTC daily | No | Has fired once in eleven months |
| Invoice, private hire | Button on the booking | Yes, not editable | "Hi {full name}", signed by the company |
| Reminders: due date, then 7, 14 and 30 days overdue | 09:00 UTC daily, plus two GitHub schedules | No | "Dear {company}", "Final Reminder", signed by the company |
| Manual chase | Chase Payment button | Yes, editable | Warm, first person, signed Peter Pitcher with mobile |
| Receipt | Automatic when a payment is entered by hand | No | First person, signed with the pub landline |
| Receipt for a PayPal payment | Nothing is sent | | |
| Payment link email | Button | Not editable | "Hi {first word of company name}", signed "Trading as The Anchor" |

Live numbers on 4 October 2026: 72 invoices, 13 customers invoiced, 9 open invoices worth £12,869.80, of which 5 are past due (£9,054.00). 71 customer reminders have been sent. In the last twelve months 81% of payments were entered by hand, so the app often does not know yet that a customer has paid.

## R0. Stop the harm

Small fixes, no new wording. **Order matters: R0.1, the R0.2 code fix and R0.5 are confirmed live in production first. The two data fixes are applied only after that.**

**R0.1 Pause automatic customer reminders.**
`src/app/api/cron/invoice-reminders/route.ts` stops emailing customers. It still marks invoices overdue and still emails the owner on the same days, with the alert text corrected to say "No customer email was sent. Automatic reminders are paused. Chase from the invoice page." (Today the alert says "Customer reminder has been sent" before the send is even tried.) Until R2 switches reminders back on in the new voice, chasing is by hand from the Chase Payment dialog, which is already warm, editable and signed by Peter.
- The owner alert is sent by the ordinary email route to the Orange Jelly mailbox, not through the invoice sender. So it is no longer saved as if it were a customer invoice email, and it carries no invoice PDF.
- Why a pause and not a reword: the old job has four stages, exact-day matching and a duplicate check tied to the subject line. Rewording it safely is more work than replacing it in R2.

**R0.2 Saving a client on the Vendors page wipes its email and contact name.**
The form at `src/app/(authenticated)/invoices/vendors/page.tsx` does not send those two fields, and `VendorService.updateVendor` in `src/services/vendors.ts` writes null for both. Every record the audit log shows as saved there (seven) is now blank.
- Fix: `updateVendor` stops writing `email` and `contact_name`. No form sends them.
- Test: saving the form leaves the stored email and contact name unchanged.
- Data: restore the email on the four private hire records, from the booking's contact email, so the Chase Payment dialog prefills. The statements were applied to production on 4 October 2026 with the owner's yes: `tasks/data-fixes-2026-10-04-invoice-r0.sql`. The business records are left as they are: each has a primary contact holding the same address. After the restore, recording a payment for these four guests emails them a receipt, as it already does for every other client.

**R0.3 Recurring invoices are sent but never chased.**
`src/app/api/cron/recurring-invoices/route.ts` marks the invoice sent before it emails it, and never records `sent_at`. The reminder job skips any invoice without `sent_at`. If the email fails, the invoice still shows as sent and is never retried.
- Fix: mark the invoice sent only after the email succeeds, with `buildInvoiceSentUpdate` (the order the billing run already uses). On failure the invoice stays a draft and `reportCronFailure` is called. This covers every way the send can fail to happen, not only a provider error: email not configured, the recipient lookup failing, and no address on file. Each of those exits runs after the schedule has already moved on, so each must leave the draft and raise the alert.
- The alert names the invoice and links to that exact draft, and says to send it from the Email Invoice button once the cause is fixed. Re-running the schedule is not the fix.
- Test: the email fails, so the invoice is still a draft, has no `sent_at`, and an alert was raised.
- Before go-live: confirm `CRON_ALERT_EMAIL` is set in production and reaches the owner. A failed recurring invoice is not retried (the schedule has already moved on), so that alert is the safety net. No such alert has ever been recorded, so it is unproven.
- Data: backfill `sent_at` and `sent_to` on INV-003WD and INV-003WV from their email log rows.

**R0.4 One scheduler for invoice jobs.**
Delete `.github/workflows/invoice-reminders.yml`. Remove the `invoice-reminders` and `auto-send-invoices` jobs from `.github/workflows/cron-jobs.yml`. Both are already in `vercel.json`. The late GitHub runs have fired as late as 22:04 London.

**R0.5 Retire the 07:00 auto-send.**
Remove `/api/cron/auto-send-invoices`, its `vercel.json` entry and its tests. It has sent one invoice in eleven months, skips 9 of 14 clients, and can post a draft nobody chose to send. No draft is waiting on it today. It goes before the R0.2 data fix because restoring emails would widen what it can reach.

**R0.6 Delete `scripts/trigger-invoice-reminders.ts`** and the tests that pin it. It is a stale copy of the reminder job that ignores credit notes, deleted invoices and whether the invoice was ever sent.

**R0.7 Manual chases are never logged.**
The chase action in `src/app/actions/email.ts` inserts a column, `email_type`, that `invoice_email_logs` does not have, so the insert fails every time and the "recent reminder" warning never sees a manual chase. Remove the field. The warning also ignores owner alerts, or it would warn the owner off chasing on the very day the alert tells him to.

## R1. One sender, one voice

**R1a. Send from the Orange Jelly mailbox.**
When `INVOICE_EMAIL_PROVIDER=graph` is set, invoice emails are pinned to Microsoft Graph (`provider: 'graph'`) at each place that sends one: `sendInvoiceEmail` in `src/lib/microsoft-graph.ts` (invoices, chases, receipts), the statement send in `src/app/actions/oj-projects/client-statement.ts`, the private booking receipt in `src/app/actions/privateBookingReceipt.ts`, and the payment link email in `src/lib/email/invoice-payment-emails.ts` until R1b retires it. They then leave from the real mailbox, sit in its Sent Items, and replies come straight back. This is what the owner asked for on 7 August and what the code did before 22 June.
- Trade-off: Microsoft does not tell the app whether an email was delivered or bounced. A bounce arrives in the mailbox as an ordinary "undeliverable" email. The app still records every send, with recipients and wording.
- The name clients see in the From line is the mailbox's own name in Microsoft 365. The app cannot set it.
- `invoiceReplyToAddress()` stays. Quotes are left alone.
- A customer send that fails in any invoice job calls `reportCronFailure`, which goes by the ordinary email route, not the pinned mailbox, so a mailbox fault is still reported. For the same reason the owner alert in the reminder job is sent by the ordinary route to the Orange Jelly mailbox, not through `sendInvoiceEmail`.
- Before the switch is set: one test invoice email to the owner, sent only with his explicit yes. Check the From name, the copy in Sent Items, that a reply arrives, and that a copied address receives it. That proves the mailbox works on that day, not for ever, which is why a failed send must always raise an alert.
- **Copied addresses.** The shared sender checks its block list for the main recipient only. The invoice sender now checks each copied address too, drops any that is blocked, and records who was proposed, who was dropped and who was actually sent to. Late non-delivery on the mailbox route is not visible to the app and is shown as "Sent (delivery not tracked)".
- **Sent and recorded are two different things.** If the mailbox accepts an email and the app then fails to save its record of it, the email counts as sent. It is never sent again for that reason, and the missing record is reported as a warning. A send that was definitely refused can be retried. A send whose outcome is unknown (a timeout) is not retried automatically: it is reported for a person to check in Sent Items.

**R1b. One voice.** Ships as a few small changes, one per group of senders, all drawing on the same module.

- **Greeting.** One function, `resolveInvoiceGreeting`, worked out on the server and passed to the dialogs: the first name of the client's primary contact, else the first name on the linked guest record (private hire), else "Hi there". Never a company name. On today's data 6 clients greet from their primary contact, 6 from the guest record, and 2 would get "Hi there" until a contact is added. The payment page uses the same function (today it greets by the first word of the company name).
- **Sign-off.** One constant, the one the hand-sent emails already use: "Many thanks, / Peter Pitcher / Orange Jelly Limited / 07990 587315". It is fixed text and does not read `COMPANY_CONTACT_PHONE`, which holds the pub landline in production (35 of 36 receipts carry the landline). The mistyped mobile in `.env.example` is corrected.
- **Wording.** One module, `src/lib/invoices/email-copy.ts`, holds the wording in "The emails" below for: invoice by hand, monthly, recurring, private hire, additional charges, manual chase and receipt. Statements and quotes are untouched. The private booking receipt and payment statement (`src/app/actions/privateBookingReceipt.ts`) keeps its own body and its own identity as a booking document, and gains the shared greeting and sign-off. It is about a booking, not one invoice, so it stays in the booking's history.
- **Defaults, not handcuffs.** The module supplies the default wording. Where staff can edit before sending, what they send is what goes; the tests check the generated defaults, not hand edits.
- **Pay online line.** Receipts never carry it, as today: they confirm money received. Elsewhere it stays added by the server (the link token must never be made in the browser) but becomes a P.S. in the same voice, and the false "just reply and I'll send the details" goes: the bank details are printed on every invoice. The send dialogs say "A pay online link will be added as a P.S." for clients who have it.
- **Label every email.** `sendInvoiceEmail` records what kind of email it is (invoice, chase, receipt, and later reminder) and who was copied, in the metadata it already saves. Internal alerts are labelled as internal. Today they are saved as if they were customer invoices. R2 and R3 depend on this.
- **Retire the separate payment link email.** Every invoice email already carries the link. The button becomes "Resend invoice" and opens the Email Invoice dialog. The Copy Payment Link confirmation stops saying "ready to paste into WhatsApp".
- **Tests.** One fixture test renders every wording for: a business client, a private hire customer, a part paid invoice, an invoice reduced by a credit note, a fully settled invoice, an overpaid invoice, a private hire invoice with the deposit applied and one with the deposit held separately, a client with no contact, a long name with punctuation, and missing reference and event date. The credit-aware balance helper in `src/lib/invoices/balance.ts` stays the only source of what is owed; where credits reduce a balance the email shows them, so the figures add up. It fails on `undefined`, `Invalid Date`, `NaN`, a company name in the greeting, a banned dash, a leftover `{` or `}`, or a different sign-off. One known date must render the right weekday under both `npm test` and `npm run test:utc`.

## R2. Reminders back on, in the new voice
Off until `INVOICE_REMINDERS_GO_LIVE_DATE` is set. Until then the job behaves as R0.1: no customer email, and the owner's summary lists every overdue invoice under "Needs you".

**Schedule.**

| Stage | When | Sent by |
|---|---|---|
| Due date | Nothing | |
| First reminder | 5 to 13 days overdue | Automatic |
| Second reminder | 14 to 20 days overdue, at least 7 days after the first, and only if the first was sent | Automatic |
| 21 days or more overdue | Nothing automatic. Listed under "Needs you" | The owner, from the Chase Payment dialog |

An invoice gets at most two automatic reminders, ever. Why these days: over the last twelve months invoices were typically paid 3 days after the due date, so an email on the due date mostly reaches people who are about to pay. A window replaces today's exact-day match, where a reminder missed on its day is lost for good.

The windows are deliberate about their edges. A first reminder that could not go inside days 5 to 13 is not caught up later: the invoice goes to "Needs you". If the first went late in its window, the second may have only a day or two left, or none; then the invoice has had one automatic reminder and goes to "Needs you" at 21 days. An invoice is only listed as "no first reminder sent" once its first window has passed, not before.

**What counts as sent.** Two new columns on the invoice record the day each reminder was accepted for sending: `reminder_first_sent_at` and `reminder_second_sent_at`. They are the lasting record. They survive a changed due date and they do not expire, so "at most two, ever" does not rest on a temporary lock. The second reminder counts its seven days from the first column.

Around each send the job takes a short-lived claim, with a fixed key per invoice and stage (`invoice-reminder:v2:{invoice}:{stage}`) that no longer includes the number of days overdue. The old job's claims are ignored: they mixed owner alerts with customer sends, so they prove nothing about what a customer received. Then:
- **Accepted:** the column is written and the claim is closed.
- **Definitely refused** (blocked address, email suspended, provider said no): the claim is released, so the next run may try again while the window is open. It is listed under "Problems".
- **Unknown** (a timeout, or the email went but the column could not be written): the claim is kept, nothing is retried automatically, and it is listed under "Problems" with the instruction to check Sent Items before chasing.

A replacement invoice issued after a reissue is a new invoice and starts its own sequence.

**When.** Monday to Friday at 09:30 UTC (`30 9 * * 1-5` in `vercel.json`), which is 09:30 in winter and 10:30 in summer. No clock-change logic is needed. One completed run per London date, enforced by a `cron_job_runs` record as the private booking monitor does.

**A reminder is skipped when any of these is true.** The checks are repeated immediately before each email is sent, against fresh data, so a payment, a hold or a manual chase entered during the run still counts. If the job cannot read what it needs for an invoice, it sends nothing for it and reports a problem.
- Nothing is owed, the invoice is paid, void, written off or deleted, or the app has no record of emailing it (`sent_at` is empty, the test the job uses today).
- The invoice belongs to a private booking (see below).
- The client was sent any invoice email by us today or on either of the two London dates before it: a new invoice, a reminder, a chase or a receipt, for any of their invoices. Only emails to the customer that were accepted for sending count; failed, refused and internal emails do not. One reminder per client per run, oldest invoice first. So nobody gets a new invoice and a reminder for the last one on the same morning.
- Reminders are held for the invoice.
- The invoice fell due before the go-live date. Those are listed under "Needs you" instead, so nobody who has already had old-style reminders gets "a quick reminder" on top.

Two jobs running at the same moment (a manual chase sent in the very second the job runs) could still both send. The gap is seconds wide and is accepted.

**Private hire invoices get no automatic reminder.** A private hire balance falls due 14 days before the event. So the first reminder window would be the nine days before the party and the second would start on the day of it. The booking code already carries a rule, pinned by a test, that an overdue balance is not chased automatically and goes to the owner for review. This job follows that rule: any invoice linked in `private_booking_invoices` is skipped and listed under "Needs you" from the first day it is late. The booking's own balance reminders before the due date are unchanged.

**Recipients.** The rule the automatic invoice emails already use (`resolveVendorInvoiceRecipients`), unchanged: the primary contact, else the address on the client record, else the first contact with an address. Copies go to contacts ticked "Receive invoice copy" and to any further addresses typed into the client record's email field. No address means no email and a line under "Needs you".

**Hold.** Invoice page: "Hold reminders until {date}" and "Resume". One new column, `invoices.reminders_held_until` (date, nullable).
- Needs invoices edit permission, checked on the server.
- The date must be today or later (London). The hold lasts through that date; reminders may resume on the next run after it.
- A reason is optional and goes in the audit log with who set it.
- A hold never resets what has already been sent. If it runs past a window, that reminder is not caught up and the invoice goes to "Needs you".

The three new columns go in one additive migration (`supabase/migrations/20261004185059_invoice_reminder_columns.sql`), with a fourth, `cron_job_runs.result`, where the job saves what each run did. It is applied to production through the `prod-migrate` process with the owner's yes, before the code that reads the columns is deployed.

**One daily summary to the owner, replacing the alert per reminder.** Sent after the run to the Orange Jelly mailbox by the ordinary email route, only when there is something to say. The job still marks invoices overdue.
- **Sent today:** each reminder, and who it went to.
- **Going next:** each reminder the rules say is due on the next run, with a link to the invoice to hold it. It is a forecast, not a promise: everything is checked again before sending. This is the safeguard against chasing someone whose transfer has not been entered yet.
- **Needs you:** overdue private hire invoices, invoices 21 days or more overdue, invoices that were already overdue at go-live, invoices with no address, invoices whose first window passed with nothing sent, and drafts dated today or earlier that have not been emailed. Shown on Mondays and on any day the list differs from the one in the last summary that was successfully sent, so it does not repeat itself daily. An invoice drops off when it is paid, voided or held.
- **Problems:** anything from this run that was refused, failed or has an unknown outcome. Each appears once. If a summary itself fails to send, its content is carried into the next one.

The run's results (what was sent, what failed, the "Needs you" list and whether the summary went) are saved on its `cron_job_runs` record. That is what the next run compares against, and it is where problems can still be read if email is suspended or the alert cannot be delivered. A second trigger on the same day does nothing, so a retry never repeats a customer email.

75 separate alerts have been sent so far. The few that needed action looked the same as the rest.

**Go-live check.** Before the switch is set, the owner is shown the list the first run would send, produced read-only against production, and says yes. The reminder route produces it: `?preview=true&go_live=YYYY-MM-DD` lists what a run would send for that go-live date and does nothing else (no email, no record, no change). `&as_of=YYYY-MM-DD` asks about another day.

**Tests.** The window and skip rules as a pure function, shared by the job, the "Going next" list and the R3 "next reminder" line, tested in both time zones: Friday to Monday, day 13 and day 20 at a weekend, the October clock change, a month end and a leap day. A first reminder that fails on day 5 and is retried on day 6. A due date changed after the first reminder, with no repeat. A send that fails raises an alert and is not recorded as sent. A send that succeeds but cannot be recorded is not sent twice.

## R3. See what was sent
An "Emails" panel on the invoice page: every customer email about the invoice, newest first, with date and time (London), kind, who it went to, who was copied, the outcome, and the wording on expand.

- Read from `email_messages` by invoice, through a server action that checks invoices view permission on every request and uses the admin client. An unknown, deleted or malformed invoice id returns nothing.
- The wording is shown as plain escaped text, never as HTML, and is not sent to any client-side logging. It can contain personal details and a payment link.
- **Outcome wording is honest.** Emails sent through the mailbox show "Sent (delivery not tracked)". Older emails keep whatever was recorded: delivered, bounced or refused. A copied address that was refused is shown as that, not as a failed email.
- **Copies.** Shown where recorded. Emails sent before R1b did not record them, and those say "copies not recorded", which is not the same as "none".
- **Internal alerts are left out.** New ones are no longer saved against the invoice at all. Old ones are recognised by how they were saved (a subject in square brackets and a reference starting "REMINDER:"), not by who they were sent to, so a genuine invoice email to the Orange Jelly mailbox still shows.
- Invoices emailed before 25 June 2026 show a note that earlier emails are not recorded here. If the app sent an email but failed to save its record, it will not appear; the invoice's own sent date and reminder dates are shown above the list as a cross-check.

Above the list, one line: "Next automatic reminder: Tuesday 13 October (forecast)", or "Reminders held until 20 October", or "No automatic reminders: both have been sent", or "No automatic reminders: chase by hand".

The Chase Payment dialog's "recent reminder" warning keeps reading the invoice's own email log, which now includes manual chases (R0.7) and the automatic reminders. Both send dialogs show the server's warnings instead of closing as a plain success.

Ships after R2.

## R4. Automatic invoices at a human hour
**Recurring invoices** (`src/app/api/cron/recurring-invoices/route.ts`): run at 09:00 UTC, Monday to Friday (09:00 London in winter, 10:00 in summer). The job already picks up schedules dated today or earlier, so one dated on a Saturday is raised on the Monday. The invoice is dated the day it is raised, and its due date counts from that day. The schedule still advances from its own date, so a monthly schedule stays on its day of the month.

**Monthly billing run** (`src/app/api/cron/oj-projects-billing/route.ts`): run at 09:05 UTC, Monday to Friday.
- The billing pass for last month starts on the first weekday of the month.
- The job keeps one record per month saying whether that month's pass has finished (a `cron_job_runs` row keyed by the billing month). Until it says finished, each weekday run during the first seven days of the month carries on: it bills every eligible client that has no billing run for that month yet, and retries runs marked failed or left half done. So a pass cut short after one client is completed the next weekday, instead of leaving the other clients until next month. The pass is finished only when a run gets through every client with none failing.
- A failed email is one of two things. Refused (nothing went): tried again the next weekday. Outcome unknown (the request left, then the connection dropped): reported once, never emailed again automatically, and it does not hold the pass open.
- Once the pass is finished, nothing more is billed that month. The existing guard (one run per client per month) still stops a client being invoiced twice.
- If the pass has not finished by the eighth, the job stops trying and raises an alert. Unbilled work then rolls into next month's invoice, as it does today.
- The billing period is still the previous calendar month. Work added during the few days a pass is being completed, for a client not yet billed, is included; that is the same period and the same rule, and the alternative is leaving it a month.
- Calls made with `force`, which the preview screen uses, skip the day check as they do today.
- The "finalise timesheets" reminders are left alone, so they will still count down to the 1st.

The recurring-charges work that was in progress in another session landed on `main` on 4 October (pull request 176). This is built on top of it.

**Timing against R1.** Once the mailbox switch is on, these emails are in the first person from the owner's own mailbox, so a 1am Sunday send becomes more obviously a machine. The next monthly and recurring runs are on Sunday 1 November 2026. R4 should be live before then.

## R5. Close the loop
**PayPal receipts.** Off until `INVOICE_PAYPAL_RECEIPTS_FROM` is set. Then a customer who pays online gets the receipt email, once per payment.
- The 15 minute PayPal check is the only sender. It sweeps for PayPal payments from the last seven days, recorded on or after the switch date, that have no receipt recorded against them, and sends those. So a receipt arrives within 15 minutes of paying. The payment itself is the lasting record that a receipt is owed; nothing new is stored.
- It is deliberately not sent from the request that records the payment (the payment page, PayPal's notification). Those requests have short time limits and a receipt renders a PDF: a request cut off part way through a send leaves an unknown outcome and risks a second receipt. Sending only from the sweep also means a receipt cannot be lost when a request dies between recording the payment and sending it.
- Each receipt is guarded by a claim on the payment, so two paths cannot both send it. A definite refusal releases the claim and the sweep tries again. An unknown outcome keeps the claim, sends nothing more, and raises an alert for a person to check.
- A receipt problem never fails the payment or the customer's page.
- Payments recorded before the switch date never get a late receipt.
- The receipt sender moves to a server-only module using the admin client, so it works when no member of staff is signed in.

**Receipts for payments entered by hand.** Record Payment gets a tick, "Email a receipt to {first name}", on by default, with the wording shown. The choice is enforced on the server. The payment is saved either way, and a receipt that fails shows a warning without undoing the payment. Today the email leaves the moment the payment is saved and the screen never says so; 11 of 21 went at a weekend.

**The PDF.** In `src/lib/invoice-template-compact.ts` the Terms box shows the real gap between the invoice date and the due date: "Due on receipt" when they are the same day, "{n} days" otherwise, and the plain due date when the gap is negative or missing (it can print "7 days" on an invoice due today). "Card payments: Available on request" is replaced by a line about paying online when the client has it. Totals, VAT, bank details and the legal identity are untouched.

## The emails

Proposed wording, plain text as today. `{...}` is filled in; `[...]` appears only when it applies. `{balance}` always means what is still to pay, never the invoice total. Every email ends with the sign-off in R1b, and the P.S. follows it:

```
Many thanks,
Peter Pitcher
Orange Jelly Limited
07990 587315

[P.S. You can also pay this online by card or PayPal: {link}]
```

**Invoice, sent by hand, and recurring.** Editable when sent by hand.
Subject: Invoice {number} from Orange Jelly

```
Hi {first name},

I hope you're well. Invoice {number} is attached[ (your reference: {reference})]: {balance}, due {Friday 9 October}.

The bank details are on the invoice. Any questions, just reply to this email or give me a ring.
```

**Invoice, monthly.**
Subject: {September} invoice from Orange Jelly ({number})

```
Hi {first name},

Here's the invoice for {September}: {balance}, due {Friday 9 October}.[ The breakdown of hours and mileage is on the invoice.][ The full timesheet is attached too.]

The bank details are on the invoice. Any questions, just reply to this email or give me a ring.
```

**Invoice, private hire.** Additional charges use the same shape with the first line "Here's the invoice for the extras we agreed for your booking at The Anchor on {date}."
Subject: Invoice {number} for your booking at The Anchor on {Saturday 14 November}

```
Hi {first name},

Thanks again for booking with us at The Anchor. Your invoice for {Saturday 14 November 2026} is attached.

[Invoice total: {total}
Payments received: {paid}]
Balance due: {balance}
Due date: {Friday 30 October 2026}

[Your deposit of {deposit} has been applied to this invoice.]
[Your booking and damage deposit of {deposit} is held separately and will be refunded within 48 hours after your event, less any documented deductions. It is not part of the amounts above.]

The bank details are on the invoice. If anything looks wrong, just reply to this email and I'll sort it out.
```

**First reminder.** Automatic.
Subject: Invoice {number}: a quick reminder

```
Hi {first name},

Just a quick nudge on invoice {number}: {balance} was due on {Friday 9 October}. I've attached another copy in case the first one got buried.

[Thank you for the {paid} already received. The {balance} is what's left.]

If it's already on its way, please ignore this.
```

**Second reminder.** Automatic.
Subject: Invoice {number}: still outstanding

```
Hi {first name},

Invoice {number} still shows {balance} to pay (it was due on {Friday 9 October}). Could you let me know when it's likely to be paid, or if something on the invoice needs putting right?

If you've already paid, sorry, just let me know and I'll check.
```

**Manual chase.** Editable. Keeps today's wording, with the new greeting and sign-off. Its old P.S. about the attached copy moves into the body, so the pay online P.S. is the only one. This is the email private hire customers get when the owner chases, so its draft names the booking at The Anchor for them.

**Receipt.**
Subject: Payment received for invoice {number}

```
Hi {first name},

I've received your payment of {amount} for invoice {number}, thank you. [That settles the invoice in full.][That leaves {balance} still to pay.] A receipt is attached for your records.
```

## Order and size

| Release | What the owner gets | Schema | Size |
|---|---|---|---|
| R0 | No robotic reminders, recurring invoices tracked again, one scheduler, client records stop being wiped | None. Two data fixes | Small |
| R1a | Emails come from the real mailbox | None | Small |
| R1b | First names, one sign-off, one voice | None | Medium, in a few parts |
| R2 | Automatic reminders return: weekdays only, two at most, can be held, one daily summary | Four columns, one migration | Medium |
| R3 | Email history and next reminder on the invoice | None | Small |
| R4 | Monthly and recurring invoices sent on a weekday morning (09:00 UTC) | None | Small, but touches the billing job |
| R5 | PayPal receipts, receipt tick, correct PDF terms | None | Small |

R0.1 and R0.5 before 10:00 London time on Thursday 8 October, the rest of R0 that week. R1a and R1b before R2, so the new schedule never sends the old wording. R4 any time after R0, and before Sunday 1 November.

**Releasing.** R0 is its own pull request and can go live alone. The rest follows in a second one, with the three switches off. Each deployment is checked on the production deployment itself before the next step. If anything has to be rolled back, the rollback keeps reminders paused: it never restores the old robotic reminders. An email already sent, and an invoice date already changed, cannot be undone by a rollback.

## Your part

Things only the owner can supply. None blocks R0.
- A contact name for the two clients who would otherwise be greeted "Hi there".
- The right address for the copied contact at Barons Pubs, whose address has been refused since 1 September. They have missed two invoices and a receipt.
- A tick on "Receive invoice copy" for each contact who should also be copied on reminders.
- Chasing the five overdue invoices by hand until they are paid: INV-003W8, INV-003WN, INV-003WG, INV-003WD, INV-003WT. R2 will not chase them; it only lists them under "Needs you". The same goes for any invoice that falls due before R2 is live.

## Not in this spec

- **Private hire deposit and balance texts, and parking and event ticket payment texts.** Not invoices. A different part of the app with its own rules. Needs its own short spec.
- **A note to the customer when an invoice they hold is cancelled.** All 10 void invoices had been emailed first and nobody was told. Worth doing, but it overlaps another session's unfinished work on reissuing invoices.
- **Editable private hire invoice emails, a per client "do not chase" switch, bank holidays.** Cut to keep this buildable. The per invoice hold and the "Going next" list cover the need. Known gap: with no bank holiday rule, a reminder could go on Friday 25 December 2026 unless held, and January's monthly invoices would go on Friday 1 January 2027.
- **Quotes.** None has ever been created, and the quote screens fail on a column that does not exist.
- **Statements.** The button has never been used. R1a makes it send from the right mailbox and nothing more.
- **Credit note documents, a write off button, PayPal refund messages, reading replies into the app, replying on the original email thread, the PayPal checkout label, removing the dead tables `invoice_reminder_settings` and `invoice_email_templates`.**

## Assumptions

1. Invoice emails come from the Orange Jelly mailbox through Microsoft Graph, at the cost of delivered and bounced tracking in the app.
2. Automatic customer reminders are paused from R0 until R2, and the owner chases by hand in between.
3. No email on the due date. Two automatic reminders, in the 5 to 13 and 14 to 20 day windows, then the owner takes over.
4. Private hire invoices get no automatic reminder. The owner chases them by hand, prompted by the daily summary.
5. Monthly and recurring invoices keep sending without approval.
6. The sign-off everywhere is the one the hand-sent emails use today.
7. The other session's billing and reissue work landed on `main` on 4 October (pull request 176). Everything here is built on top of it.
8. Receipts carry no pay online line. Copies keep going to everyone they go to today. A reminder window that is missed is not caught up. The private booking receipt keeps its own wording with the shared greeting and sign-off. These are the developer review's recommended defaults.

## As built

Where the build differs from the text above, or settles something it left open.

**R1**
- The button that replaces "Email Payment Link" reads "Resend Invoice" (the UI standard is Title Case on buttons).
- The default invoice wording no longer copies the invoice's notes into the email. They are on the PDF.
- The additional charges email takes the same subject shape as the private hire invoice.
- With the mailbox switch on, a statement's replies go to the Orange Jelly mailbox. With it off, a statement is sent exactly as before.
- A contact saved as a role, a couple or a company ("Accounts Team", "Mr & Mrs Smith", "Golden Barrels Limited") is greeted "Hi there", not by its first word.
- Resend Invoice on a private hire invoice drafts the private hire wording, naming the booking at The Anchor. It leaves the deposit sentence out, because that dialog does not know how the deposit was treated.
- A fully paid private hire invoice sent again says it is paid in full and asks for nothing.
- An identical email sent twice within an hour is still stopped as a duplicate, but the dialog now says so instead of closing as if it had gone.
- The shared email sender now says when a failed send has an unknown outcome, separately from a definite refusal. Only a clear "no" from the provider (a 4xx answer), a kill switch, a blocked address or a failed sign-in counts as refused. A timeout, a dropped connection or a server error counts as unknown. Reminders, receipts, the billing run, the recurring job and the manual sends all act on that, not on the wording of an error.
- Alert emails keep record links and dates intact. The redaction that strips phone numbers used to read a record id as one, which broke about a third of "open this draft" links. The manual send and chase tell staff when an email may already have gone, and when it went but could not be saved to the invoice history.

**R2**
- A reminder whose earlier attempt has an unknown outcome is listed under "Needs you" (a standing matter), not under "Problems" every day.
- The job stops starting new sends 200 seconds into a run and leaves the rest for the next run, so a send is never cut off part way.

**R4**
- Months before October 2026 are left as the old rule left them: the first month with a pass record is October 2026, billed in November. Without that, the first run after go-live would have re-opened September's billing.
- A billing run left half done by a timeout is picked up the next weekday, as a failed one is.
- A recurring schedule that could not raise its invoice at all now raises an alert. It is tried again on the next run.
- The alert on the eighth marks the month as given up, so it is raised once.
- A recurring schedule's end date is compared with the scheduled date, not today, so a last invoice due on a Saturday end date is still raised on the Monday.

**R5**
- The 15 minute sweep is the only sender of PayPal receipts (see R5). An independent review found that sending from the payment request itself risked a second receipt if the request was cut off.
- The sweep sends at most 20 receipts a run, and gives a payment up, with one alert, after three refusals.
- The PDF's "For payment queries or to arrange card payment" line now reads "For payment queries" (owner decision, 4 October 2026): nothing offers card payment by arrangement any more.

**Known and accepted**
- A manual chase sent in the same second as the reminder job could still both go.
- If the 15 minute job dies in the instant after the mailbox accepts a receipt, the receipt could be sent twice (the claim is taken over after ten minutes). The job stops starting sends 40 seconds in, so this needs a crash, not a slow run. The reminder job does not have this gap: its claims are never taken over.
- A provider outage (a server error) parks that day's reminders and receipts as "outcome unknown" rather than retrying them. The owner is told and chases or sends by hand. That is the price of never sending twice.
- Calling the billing route by hand with `preview=true` but without `force` can create draft invoices on any weekday up to the 7th while a pass is open, and the next scheduled run then emails them. Before, that was possible on the 1st only. The preview screen is not affected: it uses `force` with `dry_run`, which writes nothing.
- Setting `INVOICE_PAYPAL_RECEIPTS_FROM` to a past date sends receipts for PayPal payments back to that date, up to seven days. Set it to the day it is switched on.
- An email the app sent but could not record is missing from the history. Its reminder date is still recorded on the invoice.
- Bank holidays are working days. A reminder could go on Friday 25 December 2026 unless held, and January's monthly invoices would go on Friday 1 January 2027.
- No screen was opened in a signed-in browser. The new screens (hold control, email history, receipt tick) are covered by component tests only.

## What the developer review changed

| Finding | What changed |
|---|---|
| INV-01 reminder claims cannot be kept as they are | R2: two lasting columns record each accepted reminder; new fixed claim keys; old claims ignored; accepted, refused and unknown outcomes defined |
| INV-02 a receipt can be lost after payment | R5: the 15 minute PayPal check is the only sender and works from the payments themselves, so none can be lost; a claim per payment; unknown outcomes are not retried |
| INV-03 a billing pass cut short is neither missed nor failed | R4: one record per month says whether the pass finished; weekday runs in the first seven days complete it, retrying failed and half-done clients |
| INV-04 sent and recorded are different | R1a: an accepted send is never repeated because its record failed; R2 keeps its own lasting record; R3 says what it cannot show |
| INV-05 the three day rule and the forecast were loose | R2: today plus the two London dates before; accepted customer emails only; no catch-up; "Going next" is a forecast; rechecked before each send |
| INV-06 the summary needs state and a fallback | R2: results saved on the run record; "Needs you" compared with the last summary that went; R0.3: every failure exit keeps the draft and links to it |
| INV-07 private booking receipt | R1b: shared greeting and sign-off, own body, stays in booking history |
| INV-08 who is copied | R2 describes the real rule; R1a checks copied addresses against the block list and records them |
| INV-09 hold and access | R2: who may hold, date rule, optional reason; R3: view permission on every request, escaped text |
| INV-10 hiding old internal alerts | R3: recognised by how they were saved, not by recipient; missing copies shown as not recorded |
| INV-11 release plan | "Release switches", the releasing note under "Order and size", and the four owner-only steps |
| INV-12 wider test data | R1b fixture list; receipts carry no pay link; R5 PDF terms for same-day and odd dates |
| INV-13 release checklist | In the plan |

Not taken up as written: a stored list of the clients in each billing pass (the per-month record does the job with less), and a new store for receipts owed (the payment row already is one). A watertight guard against a manual chase and the job sending in the same second is accepted as a small risk rather than built.

## Evidence

Discovery, 4 October 2026: six readers over the code and the live database, then three checkers who re-traced every finding (119 findings, none refuted outright). Version 1 of this spec was then reviewed from four angles (developer, owner and customer, live send risk, scope), and every blocking point was re-checked by a second reviewer: 30 raised, 26 confirmed, 4 partly confirmed, none dismissed. Version 2 answered them mostly by cutting. Version 2 was then checked twice more: once that every point was resolved (it was), and once by simulating each release going live against today's nine open invoices. That found two faults in the reminder rules, both corrected here: the rule never to chase an invoice the app did not email had been dropped, and automatic reminders for private hire would have landed in the days before the customer's event.

Checked by hand against production: the sender address by month, the nine open invoices and their reminder history, the seven wiped client records, the three schedulers, and what the current job will send on 8 October.

Not checked: that Microsoft Graph can send as the Orange Jelly mailbox today (R1a's test send covers it), the Resend dashboard, Vercel cron run logs, where replies actually land, and no screen was opened in a signed-in browser. PDFs and emails were read as code, not viewed.
