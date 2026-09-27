/**
 * How a recurring invoice schedule's state looks: the DS Badge tone and the words. Invoice and
 * quote statuses have their own map in src/lib/invoices/status-ui.ts.
 */

type ScheduleBadgeTone = 'success' | 'neutral'

export const RECURRING_SCHEDULE_TONE: Record<'active' | 'inactive', ScheduleBadgeTone> = {
  active: 'success',
  inactive: 'neutral',
}

export function recurringScheduleTone(isActive: boolean): ScheduleBadgeTone {
  return RECURRING_SCHEDULE_TONE[isActive ? 'active' : 'inactive']
}

export function recurringScheduleLabel(isActive: boolean): string {
  return isActive ? 'Active' : 'Inactive'
}

/** The flags on a vendor contact in the vendor Contacts dialog: primary contact and invoice copy. */
export const VENDOR_CONTACT_FLAG_TONE = {
  primary: 'success',
  invoiceCc: 'info',
} as const satisfies Record<string, 'success' | 'info'>
