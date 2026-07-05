export type DashboardPrivateBookingBalanceDueSummary = {
  id: string
  customer_name: string | null
  balance_due_date: string
  event_date: string | null
  status: string | null
  total_amount: number | null
}

export type DashboardPrivateBookingBalanceDueRow = {
  id: unknown
  customer_name?: unknown
  customer_first_name?: unknown
  customer_last_name?: unknown
  balance_due_date?: unknown
  event_date?: unknown
  status?: unknown
  total_amount?: unknown
  calculated_total?: unknown
  gross_total?: unknown
  final_payment_date?: unknown
}

export type DashboardPrivateBookingPaymentRow = {
  booking_id?: unknown
  amount?: unknown
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  return fallback
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function getCustomerName(booking: DashboardPrivateBookingBalanceDueRow): string | null {
  const directName = toStringOrNull(booking.customer_name)
  if (directName) return directName

  const nameParts = [booking.customer_first_name, booking.customer_last_name]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)

  return nameParts.length > 0 ? nameParts.join(' ') : null
}

export function buildPrivateBookingBalanceDueSummaries(
  bookings: DashboardPrivateBookingBalanceDueRow[],
  payments: DashboardPrivateBookingPaymentRow[],
): DashboardPrivateBookingBalanceDueSummary[] {
  const balancePaymentsByBookingId = new Map<string, number>()

  for (const payment of payments) {
    if (payment.booking_id == null) continue

    const bookingId = String(payment.booking_id)
    const amount = toNumber(payment.amount)
    balancePaymentsByBookingId.set(
      bookingId,
      roundCurrency((balancePaymentsByBookingId.get(bookingId) ?? 0) + amount),
    )
  }

  return bookings.flatMap((booking) => {
    if (booking.id == null) return []

    const bookingId = String(booking.id)
    const balanceDueDate = toStringOrNull(booking.balance_due_date)
    if (!balanceDueDate) return []

    // Customer-payable total is VAT-inclusive (stored prices are net)
    const eventTotal = toNumber(booking.gross_total ?? booking.calculated_total ?? booking.total_amount)
    const balancePaid = balancePaymentsByBookingId.get(bookingId) ?? 0
    const outstanding = booking.final_payment_date
      ? 0
      : Math.max(0, roundCurrency(eventTotal - balancePaid))

    if (outstanding <= 0) return []

    return [{
      id: bookingId,
      customer_name: getCustomerName(booking),
      balance_due_date: balanceDueDate,
      event_date: toStringOrNull(booking.event_date),
      status: toStringOrNull(booking.status),
      total_amount: outstanding,
    }]
  })
}
