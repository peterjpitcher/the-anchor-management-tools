/**
 * Who may overwrite what on a receipt payment.
 *
 * Every vendor and expense category carries a source. In order of authority: a person
 * (`manual`, `ai_accepted`), the Amex import (`import`), invoice pairing (`invoice`), a rule
 * (`rule`), the AI (`ai`), nothing. A deliberate blank counts as a decision, so a value a
 * person cleared keeps the `manual` source.
 *
 * Automation never replaces something a higher authority decided. The database functions that
 * write under a row lock (`apply_receipt_invoice_match`) repeat these rules in SQL, so the two
 * must be changed together.
 */

type FieldSource = string | null | undefined

/** Sources a rule (on import, on refresh or run over history) may overwrite. */
const RULE_WRITABLE_SOURCES = new Set(['ai', 'rule'])

/** Sources invoice pairing may overwrite. It outranks rules and the AI. */
const INVOICE_WRITABLE_SOURCES = new Set(['ai', 'rule', 'invoice'])

function hasNoSource(source: FieldSource): boolean {
  return source === null || source === undefined || source === ''
}

/** A rule may write a vendor or category only where nothing above it has decided. */
export function canRuleWriteField(source: FieldSource): boolean {
  return hasNoSource(source) || RULE_WRITABLE_SOURCES.has(source as string)
}

/** Invoice pairing may write the vendor where no person or import decided it. */
export function canInvoicePairingWriteField(source: FieldSource): boolean {
  return hasNoSource(source) || INVOICE_WRITABLE_SOURCES.has(source as string)
}

/** The AI fills blanks only: no value and no recorded decision. */
export function canAiWriteField(value: string | null | undefined, source: FieldSource): boolean {
  return (value === null || value === undefined || value === '') && hasNoSource(source)
}

/**
 * Automation may change a status only on a pending payment, and not on one a person put back
 * to pending by hand. Closed payments are never moved: a rule run over history classifies them
 * and leaves their status, their receipt flag and who marked them alone.
 */
export function canAutomationChangeStatus(transaction: {
  status: string
  marked_method?: string | null
}): boolean {
  return transaction.status === 'pending' && transaction.marked_method !== 'manual'
}
