# Plan: weekly invoice chasers until paid

Date: 29 October 2026. Discovery: `tasks/discovery-2026-10-29-invoice-weekly-chasers.md` (owner's checkout, not committed).

## The ask

Owner, 29 October 2026: "We should never stop emailing them if something isn't paid. ... It should be sent weekly once it breeches the agreed schedule for chasing until it's paid without exception."

This replaces the 4 October 2026 rule that an invoice gets at most two automatic reminders, after which the owner chases by hand (`tasks/spec-2026-10-04-invoice-issuing-and-chasing.md`, R2).

## Decisions (owner, 29 October 2026)

1. Invoices that fell due before reminders went live on 5 October are chased too: "all invoices need to be followed up on".
2. Private hire invoices are chased weekly from 21 days overdue, about a week after the party.
3. The "hold reminders until" date still pauses an invoice.
4. A client with several unpaid invoices gets one weekly email listing them all, "with each one attached".

Accepted with the discovery's change list: first and second reminders unchanged; weekly from 21 days, at least 7 days after the last reminder, until paid, voided or written off; an unknown send outcome counts as that week's email; a chase sent by hand counts as that week's email; invoices marked sent without an email record are chased too; still never chased: paid, void, written off, nothing owed, no address, a payment waiting in the bank feed, a cancelled booking's invoice, the master switch off, the email kill switches on.

## Assumptions

- "Breaches the agreed schedule" means the point where the schedule handed over to the owner: 21 days overdue.
- One email per client per run covers every invoice of theirs due a reminder on that run, whatever its stage (first, second or weekly), not only the weekly ones. Otherwise a client's weekly email and another invoice's first reminder compete for the one slot a run gives a client, and the younger invoice's window can pass with nothing sent.
- The weekly clock is per client as well as per invoice, so a client's invoices fall into step and get one email a week between them.
- A weekly chaser whose outcome is unknown is recorded as sent, so the next one goes a week later and never twice in a week. Its claim is per London week, which blocks a repeat that week even if the record cannot be written.
- A cancelled booking's invoice that is still open waits for its credit note and is listed under "Needs you", never chased.
- The email history of each invoice a combined email covered lists it (`metadata.covers_invoice_ids`). The email itself is recorded once, against the oldest invoice.

## Release switch

`INVOICE_WEEKLY_REMINDERS_FROM=YYYY-MM-DD`. Unset, unreadable or a future date: today's behaviour exactly. It does nothing while `INVOICE_REMINDERS_GO_LIVE_DATE` is unset.

## Pieces

- [x] PR A: migration `20261029164104_invoice_weekly_reminder_column.sql` (`invoices.reminder_last_weekly_sent_at`, additive, nullable) and the generated types. Validated on a throwaway local Postgres 17.
- [x] PR B: rules (`reminder-rules.ts`), job (`reminder-job.ts`), wording (`email-copy.ts`), sender options (`microsoft-graph.ts`), summary, Emails panel (`email-history.ts`, `invoice-reminders.ts`), preview (`?weekly_from=`), switch (`release-switches.ts`, `.env.example`), tests.

## Release order

1. Owner's yes, then apply the migration to production through `prod-migrate` (Supabase MCP `apply_migration`). Regenerate the types and confirm no difference.
2. Merge PR A, then PR B. Deployed with the switch unset: nothing changes for customers.
3. Read-only preview on production: `/api/cron/invoice-reminders?preview=true&go_live=2026-10-05&weekly_from=<date>`. Owner sees who the first weekly run would email and says yes.
4. Set `INVOICE_WEEKLY_REMINDERS_FROM` in Vercel production (`vercel env add ... --no-sensitive`), redeploy, then check the first run: the owner's summary, Sent Items, and the invoices' weekly column.

## Results

- Local gates on 29 October 2026: see the PR descriptions.
