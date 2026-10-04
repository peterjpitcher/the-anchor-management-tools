/**
 * The email that goes with a monthly Orange Jelly invoice, and what it may promise.
 *
 * PURE: no database, no clock. The wording itself lives in src/lib/invoices/email-copy.ts
 * (`buildMonthlyInvoiceEmail`); this decides which of its optional sentences are TRUE for one
 * particular invoice, by reading the notes that are printed on that invoice.
 *
 * The old email told every client "The invoice notes include a breakdown of hours and
 * mileage", including clients billed for recurring charges only, whose notes carry no hours
 * and no mileage. Reading the notes, not the billing settings, keeps the promise honest in
 * both places an invoice is emailed from: straight after it is raised, and when a later run
 * re-sends a draft that an earlier attempt left behind (by then the settings may have changed,
 * and staff may have edited the draft).
 */
import { buildMonthlyInvoiceEmail, type InvoiceEmailDraft } from '@/lib/invoices/email-copy'

/**
 * Section headings in the notes the billing cron writes on an invoice. The cron pushes these
 * exact constants, and `describeOjInvoiceNotes` looks for them, so the two cannot drift apart.
 */
export const OJ_NOTES_TIME_HEADING = 'Time'
export const OJ_NOTES_MILEAGE_HEADING = 'Mileage'
/** The first line of the notes on a statement-mode invoice. */
export const OJ_NOTES_STATEMENT_HEADING = 'Account balance summary (inc VAT)'

/** What the notes printed on an invoice really carry. */
export function describeOjInvoiceNotes(notes: string | null | undefined): {
  breakdownOnInvoice: boolean
  balanceSummaryOnInvoice: boolean
} {
  const lines = String(notes ?? '')
    .split('\n')
    .map((line) => line.trim())

  const balanceSummaryOnInvoice = lines.includes(OJ_NOTES_STATEMENT_HEADING)
  // A heading is a whole line. Entry lines start with "- " and totals with a label, so a
  // description that merely mentions time or mileage cannot be mistaken for a section.
  const breakdownOnInvoice =
    !balanceSummaryOnInvoice && (lines.includes(OJ_NOTES_TIME_HEADING) || lines.includes(OJ_NOTES_MILEAGE_HEADING))

  return { breakdownOnInvoice, balanceSummaryOnInvoice }
}

export function buildOjMonthlyInvoiceEmail(input: {
  /** From `resolveInvoiceGreetingName`: a person's first name, or null for "Hi there". */
  firstName: string | null
  invoiceNumber: string
  /** Any date inside the billed month, in practice the billing period's start. */
  periodDate: string
  /** What is still to pay, from `invoiceBalanceDue`. */
  balance: number
  dueDate: string
  /** The notes printed on THIS invoice. */
  notes: string | null | undefined
  /** True only when the timesheet PDF is attached to this very email. */
  timesheetAttached: boolean
}): InvoiceEmailDraft {
  return buildMonthlyInvoiceEmail({
    firstName: input.firstName,
    invoiceNumber: input.invoiceNumber,
    periodDate: input.periodDate,
    balance: input.balance,
    dueDate: input.dueDate,
    timesheetAttached: input.timesheetAttached,
    ...describeOjInvoiceNotes(input.notes),
  })
}
