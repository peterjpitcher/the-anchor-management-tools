/**
 * The one set of status words and colours for OJ Projects. The overview, the project list,
 * the entries list and a project's detail page all read from here, so a project or an entry
 * never changes colour between screens. Pure module, safe to import from server and client
 * components. Invoice statuses come from src/lib/invoices/status-ui.ts, not from here.
 */

export type OjBadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

type StatusStyle = { label: string; tone: OjBadgeTone }

/** A project: active is green, paused amber, completed blue, anything else (archived) grey. */
export const OJ_PROJECT_STATUS: Record<string, StatusStyle> = {
  active: { label: 'Active', tone: 'success' },
  paused: { label: 'Paused', tone: 'warning' },
  completed: { label: 'Completed', tone: 'info' },
  archived: { label: 'Archived', tone: 'neutral' },
}

/** A time, mileage or one-off entry's billing state. Unbilled work is the amber one. */
export const OJ_ENTRY_STATUS: Record<string, StatusStyle> = {
  unbilled: { label: 'Unbilled', tone: 'warning' },
  billing_pending: { label: 'Billing pending', tone: 'neutral' },
  billed: { label: 'Billed', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
}

/** What kind of entry it is. */
export const OJ_ENTRY_TYPE: Record<string, StatusStyle> = {
  time: { label: 'Time', tone: 'info' },
  mileage: { label: 'Mileage', tone: 'warning' },
  one_off: { label: 'One-off', tone: 'neutral' },
}

/** Whether an entry counts towards the next invoice. */
export const OJ_BILLABLE: Record<'billable' | 'non_billable', StatusStyle> = {
  billable: { label: 'Billable', tone: 'success' },
  non_billable: { label: 'Non-billable', tone: 'neutral' },
}

/** A work type or a recurring charge that can be switched off. */
export const OJ_ACTIVE: Record<'active' | 'inactive', StatusStyle> = {
  active: { label: 'Active', tone: 'success' },
  inactive: { label: 'Inactive', tone: 'neutral' },
}

/** An unknown value keeps its own wording and shows grey rather than breaking the page. */
function lookup(map: Record<string, StatusStyle>, value: string | null | undefined): StatusStyle {
  const key = String(value ?? '')
  return map[key] ?? { label: key, tone: 'neutral' }
}

export function ojProjectStatus(status: string | null | undefined): StatusStyle {
  return lookup(OJ_PROJECT_STATUS, status)
}

export function ojEntryStatus(status: string | null | undefined): StatusStyle {
  return lookup(OJ_ENTRY_STATUS, status)
}

export function ojEntryType(type: string | null | undefined): StatusStyle {
  return lookup(OJ_ENTRY_TYPE, type)
}

export function ojBillable(billable: boolean): StatusStyle {
  return OJ_BILLABLE[billable ? 'billable' : 'non_billable']
}

export function ojActive(active: boolean): StatusStyle {
  return OJ_ACTIVE[active ? 'active' : 'inactive']
}

/**
 * Money as text on a statement or a payment summary: a balance still owed is red, money received
 * or nothing owed is green. Whole class strings only, so Tailwind sees every class.
 */
export const OJ_MONEY_TEXT = {
  owed: 'text-danger-fg',
  settled: 'text-success-fg',
  received: 'text-success-fg',
} as const

/** A balance: owed while it is above zero, settled otherwise. */
export function ojBalanceText(amount: number): string {
  return amount > 0 ? OJ_MONEY_TEXT.owed : OJ_MONEY_TEXT.settled
}

/** Budget used, as a progress bar: red once more than 90% has gone. */
export function ojBudgetTone(percentUsed: number): 'primary' | 'danger' {
  return percentUsed > 90 ? 'danger' : 'primary'
}
