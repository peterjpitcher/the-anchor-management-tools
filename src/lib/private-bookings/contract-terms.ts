import { computeBookingMoney, type VatableBookingItem } from './vat'

/**
 * The terms a private booking contract fixes: the date, the times, the guest numbers, the rooms
 * and the price (owner decision D25, review BK-154). When the booking is changed after its
 * contract went out, the contract no longer says what the booking says, and a new version has
 * to be sent and signed.
 *
 * A snapshot of these terms is kept on the booking (`private_bookings.contract_terms`) when a
 * contract is sent, or recorded as accepted another way. Comparing it with the booking as it
 * stands is how the app knows the contract is out of date. A booking whose contract went out
 * before the snapshot existed has none, and is never flagged: the app cannot know what that
 * contract said.
 *
 * Pure, with no database or server imports, so the booking page can use it too.
 */

export const CONTRACT_TERMS_VERSION = 1

export interface ContractTerms {
  v: typeof CONTRACT_TERMS_VERSION
  /** YYYY-MM-DD, or null while the date is still to be confirmed. */
  event_date: string | null
  /** HH:MM. */
  start_time: string | null
  end_time: string | null
  end_time_next_day: boolean
  guest_count: number | null
  /** The rooms booked, sorted, each once. */
  space_ids: string[]
  /** What the customer pays for the hire, VAT included, in pounds to the penny. */
  total: number
}

/** The booking fields the terms are read from. Every one is on private_bookings. */
export interface ContractTermsBooking {
  event_date?: string | null
  date_tbd?: boolean | null
  start_time?: string | null
  end_time?: string | null
  end_time_next_day?: boolean | null
  guest_count?: number | string | null
  discount_type?: string | null
  discount_amount?: number | string | null
}

/** The item fields the terms are read from: the room, and what the line costs. */
export interface ContractTermsItem {
  space_id?: string | null
  quantity?: number | string | null
  unit_price?: number | string | null
  line_total?: number | string | null
  vat_rate?: number | string | null
  discount_type?: string | null
  discount_value?: number | string | null
}

export type ContractTermsChange = 'date' | 'times' | 'guest numbers' | 'rooms' | 'price'

function hhmm(value: string | null | undefined): string | null {
  if (!value) return null
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  if (!match) return null
  return `${match[1].padStart(2, '0')}:${match[2]}`
}

function numberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function asDiscountType(value: string | null | undefined): 'percent' | 'fixed' | null {
  return value === 'percent' || value === 'fixed' ? value : null
}

/** The terms of a booking as it stands now. */
export function contractTermsOf(booking: ContractTermsBooking, items: readonly ContractTermsItem[] | null | undefined): ContractTerms {
  const lines = items ?? []
  const money = computeBookingMoney(
    lines.map((item): VatableBookingItem => ({
      quantity: Number(item.quantity ?? 0),
      unit_price: Number(item.unit_price ?? 0),
      line_total: numberOrNull(item.line_total),
      vat_rate: numberOrNull(item.vat_rate),
      discount_type: asDiscountType(item.discount_type),
      discount_value: numberOrNull(item.discount_value),
    })),
    asDiscountType(booking.discount_type),
    numberOrNull(booking.discount_amount),
  )
  const spaceIds = Array.from(
    new Set(lines.map((item) => item.space_id).filter((id): id is string => typeof id === 'string' && id.length > 0)),
  ).sort()
  const tbd = booking.date_tbd === true
  return {
    v: CONTRACT_TERMS_VERSION,
    event_date: tbd || !booking.event_date ? null : booking.event_date.slice(0, 10),
    start_time: hhmm(booking.start_time),
    end_time: hhmm(booking.end_time),
    end_time_next_day: booking.end_time_next_day === true,
    guest_count: numberOrNull(booking.guest_count),
    space_ids: spaceIds,
    total: money.grossTotal,
  }
}

/** A stored snapshot, or null when there is none or it is not one this code can read. */
export function readContractTerms(value: unknown): ContractTerms | null {
  if (!value || typeof value !== 'object') return null
  const terms = value as Partial<ContractTerms>
  if (terms.v !== CONTRACT_TERMS_VERSION) return null
  if (!Array.isArray(terms.space_ids) || typeof terms.total !== 'number') return null
  return terms as ContractTerms
}

/**
 * What has changed between the terms in the contract and the booking now, in the order a
 * person reads a booking. Empty when nothing has, or when there is no snapshot to compare.
 */
export function contractTermsChanges(stored: unknown, current: ContractTerms): ContractTermsChange[] {
  const sent = readContractTerms(stored)
  if (!sent) return []
  const changes: ContractTermsChange[] = []
  if (sent.event_date !== current.event_date) changes.push('date')
  if (
    sent.start_time !== current.start_time ||
    sent.end_time !== current.end_time ||
    sent.end_time_next_day !== current.end_time_next_day
  ) {
    changes.push('times')
  }
  if (sent.guest_count !== current.guest_count) changes.push('guest numbers')
  if (sent.space_ids.join(',') !== current.space_ids.join(',')) changes.push('rooms')
  if (Math.round(sent.total * 100) !== Math.round(current.total * 100)) changes.push('price')
  return changes
}

/** "the date", "the date and the price", "the date, the times and the price". */
export function describeContractTermsChanges(changes: readonly ContractTermsChange[]): string {
  const parts = changes.map((change) => `the ${change}`)
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** The booking fields that say whether a contract is in play at all. */
export interface ContractStateBooking extends ContractTermsBooking {
  status?: string | null
  contract_version?: number | null
  contract_sent_at?: string | null
  contract_accepted_at?: string | null
  contract_terms?: unknown
}

export interface ContractOutOfDate {
  changes: ContractTermsChange[]
  /** The version the customer has. */
  currentVersion: number
  /** The version to send next. */
  nextVersion: number
  /** True when the version the customer has was accepted. */
  accepted: boolean
}

/**
 * Whether the contract the customer has no longer matches the booking. Only an open booking
 * (draft or confirmed) whose contract was sent or accepted, with a snapshot to compare, can be.
 */
export function contractOutOfDate(
  booking: ContractStateBooking,
  items: readonly ContractTermsItem[] | null | undefined,
): ContractOutOfDate | null {
  if (booking.status !== 'draft' && booking.status !== 'confirmed') return null
  if (!booking.contract_sent_at && !booking.contract_accepted_at) return null
  if (!readContractTerms(booking.contract_terms)) return null
  const changes = contractTermsChanges(booking.contract_terms, contractTermsOf(booking, items))
  if (changes.length === 0) return null
  const currentVersion = Number(booking.contract_version ?? 0)
  return {
    changes,
    currentVersion,
    nextVersion: currentVersion + 1,
    accepted: Boolean(booking.contract_accepted_at),
  }
}
