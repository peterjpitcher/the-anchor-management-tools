'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import {
  Card, CardHeader, CardBody,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/ds'
import { Field, Input, Button, Badge, Alert, Stat } from '@/ds'
import { Icon } from '@/ds/icons'
import { upsertSessionAction, submitSessionAction } from '@/app/actions/cashing-up'
import { getDailySummaryAction } from '@/app/actions/daily-summary'
import toast from 'react-hot-toast'
import type { CashupSession, UpsertCashupSessionDTO } from '@/types/cashing-up'

const DENOMINATIONS = [
  { value: 50, label: '£50' },
  { value: 20, label: '£20' },
  { value: 10, label: '£10' },
  { value: 5, label: '£5' },
  { value: 2, label: '£2' },
  { value: 1, label: '£1' },
  { value: 0.5, label: '50p' },
  { value: 0.2, label: '20p' },
  { value: 0.1, label: '10p' },
  { value: 0.05, label: '5p' },
  { value: 0.02, label: '2p' },
  { value: 0.01, label: '1p' },
]

interface WeeklyRow {
  session_date: string
  status: string
  total_expected_amount?: number
  total_counted_amount?: number
  total_variance_amount?: number
  target_amount?: number
}

interface Props {
  siteId: string
  siteName: string
  sessionDate: string
  dailySummary: string | null
  dailyTarget: number
  weeklyData: WeeklyRow[]
  existingSession: CashupSession | null
}

const fmt = (num: number): string =>
  num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const statusTone = (status: string) => {
  switch (status) {
    case 'approved': return 'success' as const
    case 'submitted': return 'info' as const
    case 'locked': return 'warning' as const
    default: return 'neutral' as const
  }
}

const dayName = (dateStr: string): string => {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'short' })
}

export function DailyClient({ siteId, siteName, sessionDate, dailySummary, dailyTarget, weeklyData, existingSession }: Props) {
  const getBreakdownValue = (code: string, field: 'countedAmount' | 'expectedAmount'): number => {
    if (!existingSession?.cashup_payment_breakdowns) return 0
    const bd = existingSession.cashup_payment_breakdowns.find(
      (b) => b.payment_type_code === code
    )
    if (!bd) return 0
    return field === 'countedAmount' ? bd.counted_amount : bd.expected_amount
  }

  // Restore denomination values from existing cash counts
  const getInitialCashValues = (): Record<string, string> => {
    const values: Record<string, string> = {}
    if (existingSession?.cashup_cash_counts) {
      existingSession.cashup_cash_counts.forEach((c) => {
        values[c.denomination.toString()] = c.total_amount?.toString() || '0'
      })
    }
    return values
  }

  const [cashValues, setCashValues] = useState<Record<string, string>>(getInitialCashValues)
  const [cashExpected, setCashExpected] = useState(getBreakdownValue('CASH', 'expectedAmount').toString() || '')
  const [cardTotal, setCardTotal] = useState(getBreakdownValue('CARD', 'countedAmount').toString() || '')
  const [stripeTotal, setStripeTotal] = useState(getBreakdownValue('STRIPE', 'countedAmount').toString() || '')
  const [notes, setNotes] = useState(existingSession?.notes || '')
  const [autoNotes, setAutoNotes] = useState(dailySummary || '')
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(existingSession?.id ?? null)
  const isLocked = existingSession?.status !== 'draft' && existingSession?.status !== undefined

  useEffect(() => {
    if (sessionDate) {
      getDailySummaryAction(sessionDate).then(res => {
        if (res.success && res.summary) {
          setAutoNotes(res.summary)
        }
      })
    }
  }, [sessionDate])

  const handleCashValueChange = (denomValue: number, inputValue: string) => {
    setCashValues(prev => ({ ...prev, [denomValue.toString()]: inputValue }))
  }

  const cashCountedTotal = useMemo(() => {
    return DENOMINATIONS.reduce((total, denom) => {
      const val = parseFloat(cashValues[denom.value] || '0')
      return total + val
    }, 0)
  }, [cashValues])

  const cardNum = parseFloat(cardTotal) || 0
  const stripeNum = parseFloat(stripeTotal) || 0
  const cashExpectedNum = parseFloat(cashExpected) || 0
  const cashVariance = cashCountedTotal - cashExpectedNum
  const totalRevenue = cashCountedTotal + cardNum + stripeNum
  const target = dailyTarget

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const cashCounts = DENOMINATIONS.map(denom => {
        const val = parseFloat(cashValues[denom.value] || '0')
        return { denomination: denom.value, totalAmount: val }
      }).filter(c => c.totalAmount > 0)

      const dto: UpsertCashupSessionDTO = {
        siteId,
        sessionDate,
        status: 'draft',
        notes: [notes, autoNotes].filter(Boolean).join('\n\n').trim() || null,
        paymentBreakdowns: [
          { paymentTypeCode: 'CASH', paymentTypeLabel: 'Cash', expectedAmount: cashExpectedNum, countedAmount: cashCountedTotal },
          { paymentTypeCode: 'CARD', paymentTypeLabel: 'Card', expectedAmount: cardNum, countedAmount: cardNum },
          { paymentTypeCode: 'STRIPE', paymentTypeLabel: 'Stripe', expectedAmount: stripeNum, countedAmount: stripeNum },
        ],
        cashCounts,
      }

      const res = await upsertSessionAction(dto, sessionId ?? undefined)
      if (res.success) {
        if (res.data?.id) setSessionId(res.data.id)
        setLastSaved(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
        toast.success('Session saved')
      } else {
        toast.error(res.error || 'Failed to save')
      }
    } catch {
      toast.error('Failed to save session')
    } finally {
      setSaving(false)
    }
  }, [siteId, sessionDate, notes, autoNotes, cashValues, cashExpectedNum, cashCountedTotal, cardNum, stripeNum, sessionId])

  const handleSubmit = useCallback(async () => {
    if (!sessionId) {
      await handleSave()
    }
    const idToSubmit = sessionId
    if (!idToSubmit) {
      toast.error('Please save the session first')
      return
    }
    setSaving(true)
    try {
      const res = await submitSessionAction(idToSubmit)
      if (res.success) {
        toast.success('Session submitted for approval')
      } else {
        toast.error(res.error || 'Failed to submit')
      }
    } catch {
      toast.error('Failed to submit session')
    } finally {
      setSaving(false)
    }
  }, [sessionId, handleSave])

  const handleKeyDown = (e: React.KeyboardEvent, nextId: string) => {
    if (e.key === 'ArrowRight' || e.key === 'Tab') {
      const nextElement = document.getElementById(nextId)
      if (nextElement && e.key === 'ArrowRight') {
        e.preventDefault()
        nextElement.focus()
        if (nextElement instanceof HTMLInputElement) nextElement.select()
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Column 1 — Cash denomination grid */}
        <Card>
          <CardHeader
            title="Cash"
            subtitle={lastSaved ? `Saved at ${lastSaved}` : 'Cash drawer count'}
          />
          <CardBody>
            <p className="text-xs font-semibold text-text-muted uppercase mb-2">
              Cash drawer count (total value)
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {DENOMINATIONS.map((denom, index) => {
                const nextDenom = DENOMINATIONS[index + 1]
                const nextId = nextDenom ? `input-denom-${nextDenom.value}` : 'input-cash-expected'
                return (
                  <div
                    key={denom.value}
                    className="flex items-center justify-between bg-surface-2 px-2 py-1 rounded-default border border-border"
                  >
                    <span className="text-xs font-medium text-text-muted w-8 text-center">
                      {denom.label}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <span className="text-text-subtle text-xs">£</span>
                      <input
                        id={`input-denom-${denom.value}`}
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={cashValues[denom.value] || ''}
                        onChange={(e) => handleCashValueChange(denom.value, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, nextId)}
                        onWheel={(e) => e.currentTarget.blur()}
                        className="w-20 p-1 text-right text-sm bg-transparent border-none focus:outline-none focus:ring-0 font-mono"
                        disabled={isLocked}
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Cash totals */}
            <div className="mt-3 pt-3 border-t border-border space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold text-text-strong">Total counted:</span>
                <span className="font-mono font-bold text-lg">£{fmt(cashCountedTotal)}</span>
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-border">
                <span className="text-sm text-text-muted font-medium">Expected (Z-Read):</span>
                <div className="flex items-center gap-1">
                  <span className="text-text-subtle text-xs">£</span>
                  <input
                    id="input-cash-expected"
                    type="number"
                    step="0.01"
                    value={cashExpected}
                    onChange={(e) => setCashExpected(e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, 'input-card-total')}
                    onWheel={(e) => e.currentTarget.blur()}
                    className="w-28 p-1 text-right text-sm bg-surface-2 border border-border rounded-default font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                    disabled={isLocked}
                  />
                </div>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-text">Variance:</span>
                <span className={`font-mono font-bold ${cashVariance < 0 ? 'text-danger-fg' : 'text-success-fg'}`}>
                  £{fmt(cashVariance)}
                </span>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Column 2 — Card, Stripe, Notes */}
        <Card>
          <CardHeader title="Card & Stripe" />
          <CardBody className="space-y-4">
            <Field label="Card total (terminal)">
              <Input
                id="input-card-total"
                type="number"
                step="0.01"
                value={cardTotal}
                onChange={(e) => setCardTotal(e.target.value)}
                placeholder="0.00"
                icon={<Icon name="pound" size={16} />}
                disabled={isLocked}
              />
            </Field>

            <Field label="Stripe total (dashboard)">
              <Input
                id="input-stripe-total"
                type="number"
                step="0.01"
                value={stripeTotal}
                onChange={(e) => setStripeTotal(e.target.value)}
                placeholder="0.00"
                icon={<Icon name="pound" size={16} />}
                disabled={isLocked}
              />
            </Field>

            {/* Variance summary */}
            <Alert tone="info">
              <div className="flex justify-between items-center">
                <span>Cash variance:</span>
                <strong className={cashVariance < 0 ? 'text-danger-fg' : 'text-success-fg'}>
                  £{fmt(cashVariance)}
                </strong>
              </div>
            </Alert>

            {/* Notes */}
            <Field label="Notes / variance reason">
              <Input
                id="input-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Enter your notes here..."
                disabled={isLocked}
              />
            </Field>

            {autoNotes && (
              <div className="bg-warning/10 p-3 rounded-default border border-warning/30 text-xs text-text whitespace-pre-wrap">
                <strong>Auto-detected events:</strong>
                <br />
                {autoNotes}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" onClick={handleSave} loading={saving} disabled={isLocked}>
                Save Draft
              </Button>
              <Button variant="primary" onClick={handleSubmit} loading={saving} disabled={isLocked}>
                Submit
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* Column 3 — Week at a glance */}
        <Card>
          <CardHeader title="Week at a glance" />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead align="right">Cash</TableHead>
                <TableHead align="right">Card</TableHead>
                <TableHead align="right">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {weeklyData.length === 0 ? (
                <TableRow>
                  <TableCell className="text-center text-text-muted py-6" align="center">
                    No data for this week
                  </TableCell>
                </TableRow>
              ) : (
                weeklyData.map((row) => (
                  <TableRow key={row.session_date}>
                    <TableCell className="font-medium">
                      {dayName(row.session_date)}
                    </TableCell>
                    <TableCell align="right" className="font-mono text-xs">
                      £{fmt(row.total_expected_amount ?? 0)}
                    </TableCell>
                    <TableCell align="right" className="font-mono text-xs">
                      £{fmt(row.total_counted_amount ?? 0)}
                    </TableCell>
                    <TableCell align="right" className="font-mono text-xs">
                      £{fmt((row.total_expected_amount ?? 0) + (row.total_counted_amount ?? 0))}
                    </TableCell>
                    <TableCell>
                      <Badge tone={statusTone(row.status)} dot>
                        {row.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Revenue stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardBody>
            <Stat label="Cash counted" value={`£${fmt(cashCountedTotal)}`} />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat label="Card" value={`£${fmt(cardNum)}`} />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat label="Stripe" value={`£${fmt(stripeNum)}`} />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat
              label="Total revenue"
              value={`£${fmt(totalRevenue)}`}
              delta={target > 0 ? Math.round((totalRevenue / target) * 100) - 100 : undefined}
              hint={target > 0 ? `Target: £${fmt(target)}` : undefined}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
