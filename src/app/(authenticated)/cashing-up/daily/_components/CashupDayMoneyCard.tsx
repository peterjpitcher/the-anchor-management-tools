'use client'

import { useEffect, useState } from 'react'
import { Alert, Card, CardBody, CardHeader } from '@/ds'
import { getCashupDayMoneyAction, type CashupDayMoney } from '@/app/actions/cashup-day-money'

function money(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

function countOf(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * What was paid for this day outside the till (BK-119; owner decision D33): deposits set against
 * bills, prepaid tickets, private-hire money paid online or by bank, and vouchers. Each shows as
 * till sales with no takings, so it explains part of a split difference. Shown only when there is
 * something to show.
 */
export function CashupDayMoneyCard({ sessionDate }: { sessionDate: string }) {
  const [data, setData] = useState<CashupDayMoney | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    getCashupDayMoneyAction(sessionDate).then((result) => {
      if (cancelled) return
      if (result.success) setData(result.data)
      else setError(result.error)
    }).catch(() => {
      if (!cancelled) setError('Money paid outside the till could not be loaded.')
    })
    return () => {
      cancelled = true
    }
  }, [sessionDate])

  if (error) {
    return <Alert tone="warning" size="sm">{error}</Alert>
  }
  if (!data) return null

  const lines: Array<{ key: string; label: string; amount: number }> = []
  if (data.tableDeposits.amount > 0) {
    lines.push({ key: 'deposits', label: `Table deposits paid online (${countOf(data.tableDeposits.count, 'booking', 'bookings')})`, amount: data.tableDeposits.amount })
  }
  if (data.eventTickets.amount > 0) {
    lines.push({ key: 'tickets', label: `Event tickets paid online (${countOf(data.eventTickets.count, 'booking', 'bookings')})`, amount: data.eventTickets.amount })
  }
  for (const hire of data.privateHires) {
    lines.push({ key: `hire-${hire.id}`, label: `Private hire: ${hire.label}, paid online or by bank`, amount: hire.paidOutsideTill })
  }
  if (data.vouchersRedeemed.amount > 0) {
    lines.push({ key: 'vouchers', label: `Vouchers redeemed (${data.vouchersRedeemed.count})`, amount: data.vouchersRedeemed.amount })
  }
  if (lines.length === 0) return null

  return (
    <Card>
      <CardHeader
        title="Paid outside the till for this day"
        subtitle="These show as till sales with no takings. Mention any that explain the split difference in the notes."
      />
      <CardBody>
        <ul className="divide-y divide-border text-sm">
          {lines.map((line) => (
            <li key={line.key} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 text-text">{line.label}</span>
              <span className="font-mono text-text-strong">{money(line.amount)}</span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 py-2 font-semibold">
            <span className="text-text-strong">Total</span>
            <span className="font-mono text-text-strong">{money(data.total)}</span>
          </li>
        </ul>
      </CardBody>
    </Card>
  )
}
