'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card, CardHeader, CardBody,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/ds'
import { Field, Input, Button, Badge, Alert, Stat } from '@/ds'
import { Icon } from '@/ds/icons'
import { upsertSessionAction, upsertAndSubmitSessionAction } from '@/app/actions/cashing-up'
import { getDailySummaryAction } from '@/app/actions/daily-summary'
import { getMissingCashupDatesAction } from '@/app/actions/missing-cashups'
import toast from 'react-hot-toast'
import { format, parseISO } from 'date-fns'
import type { CashupSalesCategory, CashupSession, CashupStatus, UpsertCashupSessionDTO } from '@/types/cashing-up'

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
  cash_counted_amount?: number
  non_cash_counted_amount?: number
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
  missingDates: string[]
  initialEditMode: boolean
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

const numberInputNoSpinnerClass =
  '[appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none'

const amountInputValue = (value?: number | null): string => {
  if (!value) return ''
  return value.toString()
}

const getBreakdownValue = (
  session: CashupSession | null,
  code: string,
  field: 'countedAmount' | 'expectedAmount'
): number => {
  if (!session?.cashup_payment_breakdowns) return 0
  const bd = session.cashup_payment_breakdowns.find(
    (b) => b.payment_type_code === code
  )
  if (!bd) return 0
  return field === 'countedAmount' ? bd.counted_amount : bd.expected_amount
}

const getSalesBreakdownValue = (
  session: CashupSession | null,
  category: CashupSalesCategory
): number => {
  if (!session?.cashup_sales_breakdowns) return 0
  return session.cashup_sales_breakdowns.find((item) => item.sales_category === category)?.amount ?? 0
}

const getCashValuesFromSession = (session: CashupSession | null): Record<string, string> => {
  const values: Record<string, string> = {}
  if (session?.cashup_cash_counts) {
    session.cashup_cash_counts.forEach((c) => {
      if (c.total_amount > 0) {
        values[c.denomination.toString()] = c.total_amount.toString()
      }
    })
  }
  return values
}

const shouldStartInEditMode = (session: CashupSession | null, requestedEditMode: boolean): boolean =>
  !session || session.status === 'draft' || (requestedEditMode && session.status !== 'locked')

export function DailyClient({
  siteId,
  siteName,
  sessionDate,
  dailySummary,
  dailyTarget,
  weeklyData,
  existingSession,
  missingDates: initialMissingDates,
  initialEditMode,
}: Props) {
  const router = useRouter()
  const [missingDates, setMissingDates] = useState<string[]>(initialMissingDates)

  const [cashValues, setCashValues] = useState<Record<string, string>>(() => getCashValuesFromSession(existingSession))
  const [cashExpected, setCashExpected] = useState(() => amountInputValue(getBreakdownValue(existingSession, 'CASH', 'expectedAmount')))
  const [cardTotal, setCardTotal] = useState(() => amountInputValue(getBreakdownValue(existingSession, 'CARD', 'countedAmount')))
  const [stripeTotal, setStripeTotal] = useState(() => amountInputValue(getBreakdownValue(existingSession, 'STRIPE', 'countedAmount')))
  const [drinksSales, setDrinksSales] = useState(() => amountInputValue(getSalesBreakdownValue(existingSession, 'drinks_sales')))
  const [foodSales, setFoodSales] = useState(() => amountInputValue(getSalesBreakdownValue(existingSession, 'food_sales')))
  const [otherSales, setOtherSales] = useState(() => amountInputValue(getSalesBreakdownValue(existingSession, 'other_sales')))
  const [notes, setNotes] = useState(existingSession?.notes || '')
  const [autoNotes, setAutoNotes] = useState(dailySummary || '')
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(existingSession?.id ?? null)
  const [currentStatus, setCurrentStatus] = useState<CashupStatus | null>(existingSession?.status ?? null)
  const [editMode, setEditMode] = useState(() => shouldStartInEditMode(existingSession, initialEditMode))
  const isReadOnlyStatus = currentStatus !== null && currentStatus !== 'draft'
  const isLockedStatus = currentStatus === 'locked'
  const fieldsDisabled = isLockedStatus || (isReadOnlyStatus && !editMode)

  useEffect(() => {
    setMissingDates(initialMissingDates)
  }, [initialMissingDates])

  const clearFormFields = useCallback(() => {
    setCashValues({})
    setCashExpected('')
    setCardTotal('')
    setStripeTotal('')
    setDrinksSales('')
    setFoodSales('')
    setOtherSales('')
    setNotes('')
    setAutoNotes('')
    setLastSaved(null)
    setSessionId(null)
    setCurrentStatus(null)
    setEditMode(true)
  }, [])

  useEffect(() => {
    setCashValues(getCashValuesFromSession(existingSession))
    setCashExpected(amountInputValue(getBreakdownValue(existingSession, 'CASH', 'expectedAmount')))
    setCardTotal(amountInputValue(getBreakdownValue(existingSession, 'CARD', 'countedAmount')))
    setStripeTotal(amountInputValue(getBreakdownValue(existingSession, 'STRIPE', 'countedAmount')))
    setDrinksSales(amountInputValue(getSalesBreakdownValue(existingSession, 'drinks_sales')))
    setFoodSales(amountInputValue(getSalesBreakdownValue(existingSession, 'food_sales')))
    setOtherSales(amountInputValue(getSalesBreakdownValue(existingSession, 'other_sales')))
    setNotes(existingSession?.notes || '')
    setAutoNotes(dailySummary || '')
    setLastSaved(null)
    setSessionId(existingSession?.id ?? null)
    setCurrentStatus(existingSession?.status ?? null)
    setEditMode(shouldStartInEditMode(existingSession, initialEditMode))
  }, [dailySummary, existingSession, initialEditMode, sessionDate])

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
  const drinksSalesNum = parseFloat(drinksSales) || 0
  const foodSalesNum = parseFloat(foodSales) || 0
  const otherSalesNum = parseFloat(otherSales) || 0
  const cashExpectedNum = parseFloat(cashExpected) || 0
  const cashVariance = cashCountedTotal - cashExpectedNum
  const totalRevenue = cashCountedTotal + cardNum + stripeNum
  const salesSplitTotal = drinksSalesNum + foodSalesNum + otherSalesNum
  const salesSplitVariance = Number((salesSplitTotal - totalRevenue).toFixed(2))
  const target = dailyTarget

  const buildSessionDTO = useCallback((status: UpsertCashupSessionDTO['status'] = 'draft'): UpsertCashupSessionDTO => {
    const cashCounts = DENOMINATIONS.map(denom => {
      const val = parseFloat(cashValues[denom.value] || '0')
      return { denomination: denom.value, totalAmount: val }
    }).filter(c => c.totalAmount > 0)

    return {
      siteId,
      sessionDate,
      status,
      notes: [notes, autoNotes].filter(Boolean).join('\n\n').trim() || null,
      paymentBreakdowns: [
        { paymentTypeCode: 'CASH', paymentTypeLabel: 'Cash', expectedAmount: cashExpectedNum, countedAmount: cashCountedTotal },
        { paymentTypeCode: 'CARD', paymentTypeLabel: 'Card', expectedAmount: cardNum, countedAmount: cardNum },
        { paymentTypeCode: 'STRIPE', paymentTypeLabel: 'Stripe', expectedAmount: stripeNum, countedAmount: stripeNum },
      ],
      salesBreakdowns: [
        { salesCategory: 'drinks_sales', amount: drinksSalesNum },
        { salesCategory: 'food_sales', amount: foodSalesNum },
        { salesCategory: 'other_sales', amount: otherSalesNum },
      ],
      cashCounts,
    }
  }, [autoNotes, cardNum, cashCountedTotal, cashExpectedNum, cashValues, drinksSalesNum, foodSalesNum, notes, otherSalesNum, sessionDate, siteId, stripeNum])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const res = await upsertSessionAction(buildSessionDTO('draft'), sessionId ?? undefined)
      if (res.success) {
        if (res.data?.id) setSessionId(res.data.id)
        setCurrentStatus(res.data?.status ?? 'draft')
        setEditMode(true)
        setLastSaved(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
        toast.success('Session saved')
        getMissingCashupDatesAction(siteId).then(r => {
          if (r.success && r.dates) setMissingDates(r.dates)
        })
        router.refresh()
      } else {
        toast.error(res.error || 'Failed to save')
      }
    } catch {
      toast.error('Failed to save session')
    } finally {
      setSaving(false)
    }
  }, [buildSessionDTO, router, sessionId, siteId])

  const handleSubmit = useCallback(async () => {
    const shouldStayOnCurrentDate = Boolean(sessionId && editMode && currentStatus && currentStatus !== 'draft')
    setSaving(true)
    try {
      const res = await upsertAndSubmitSessionAction(buildSessionDTO('draft'), sessionId ?? undefined)
      if (res.success) {
        toast.success('Session submitted for approval')
        setCurrentStatus(res.data?.status ?? 'submitted')
        setEditMode(false)
        if (res.data?.id) setSessionId(res.data.id)
        getMissingCashupDatesAction(siteId).then(r => {
          if (r.success && r.dates) setMissingDates(r.dates)
        })
        if (shouldStayOnCurrentDate) {
          router.replace(`/cashing-up/daily?date=${sessionDate}&siteId=${siteId}`)
          router.refresh()
        } else {
          const nextDate = missingDates.find(d => d !== sessionDate)
          clearFormFields()
          if (nextDate) {
            router.push(`/cashing-up/daily?date=${nextDate}&siteId=${siteId}`)
          } else {
            router.push('/cashing-up/dashboard')
          }
        }
      } else {
        toast.error(res.error || 'Failed to submit')
      }
    } catch {
      toast.error('Failed to submit session')
    } finally {
      setSaving(false)
    }
  }, [buildSessionDTO, clearFormFields, currentStatus, editMode, missingDates, router, sessionDate, sessionId, siteId])

  const handleOpenForEditing = useCallback(() => {
    if (isLockedStatus) {
      toast.error('Locked sessions cannot be edited')
      return
    }
    setEditMode(true)
  }, [isLockedStatus])

  const cashupDateUrl = useCallback((date: string, openForEditing = false): string => {
    const params = new URLSearchParams({ date, siteId })
    if (openForEditing) params.set('edit', '1')
    return `/cashing-up/daily?${params.toString()}`
  }, [siteId])

  const onDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = e.target.value
    if (newDate) {
      router.push(`/cashing-up/daily?date=${newDate}&siteId=${siteId}`)
    }
  }

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
      {/* Date picker row */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center gap-4">
            <Field label="Date" className="flex-shrink-0">
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={sessionDate}
                  onChange={onDateChange}
                  className="rounded-default border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <Badge tone="neutral">
                  {format(parseISO(sessionDate), 'EEEE')}
                </Badge>
              </div>
            </Field>
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <Icon name="building" size={14} />
              <span>{siteName}</span>
            </div>
            {currentStatus && (
              <Badge tone={statusTone(currentStatus)} dot>
                {currentStatus}
              </Badge>
            )}
            {dailyTarget > 0 && (
              <div className="ml-auto flex items-center gap-1.5 text-sm">
                <span className="text-text-muted">Target:</span>
                <span className="font-semibold font-mono">£{fmt(dailyTarget)}</span>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Missing dates alert */}
      {missingDates.length > 0 && (
        <Alert tone="warning">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Icon name="alertTriangle" size={16} />
              <span className="font-semibold text-sm">
                {missingDates.length} missing cashing up {missingDates.length === 1 ? 'entry' : 'entries'}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {missingDates.slice(0, 10).map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => router.push(`/cashing-up/daily?date=${d}&siteId=${siteId}`)}
                  className={`inline-flex items-center gap-1 rounded-default border px-2 py-0.5 text-xs font-medium transition-colors ${
                    d === sessionDate
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-surface hover:bg-surface-2 text-text-muted hover:text-text'
                  }`}
                >
                  {format(parseISO(d), 'EEE dd MMM')}
                </button>
              ))}
              {missingDates.length > 10 && (
                <span className="text-xs text-text-muted self-center">
                  +{missingDates.length - 10} more
                </span>
              )}
            </div>
          </div>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
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
                      <Input
                        id={`input-denom-${denom.value}`}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        placeholder="0.00"
                        value={cashValues[denom.value] || ''}
                        onChange={(e) => handleCashValueChange(denom.value, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, nextId)}
                        onWheel={(e) => e.currentTarget.blur()}
                        className={`${numberInputNoSpinnerClass} w-20 p-1 text-right text-sm bg-transparent border-none focus:outline-none focus:ring-0 font-mono`}
                        disabled={fieldsDisabled}
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
                  <Input
                    id="input-cash-expected"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={cashExpected}
                    onChange={(e) => setCashExpected(e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, 'input-card-total')}
                    onWheel={(e) => e.currentTarget.blur()}
                    className={`${numberInputNoSpinnerClass} w-28 p-1 text-right text-sm font-mono`}
                    disabled={fieldsDisabled}
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
                inputMode="decimal"
                step="0.01"
                value={cardTotal}
                onChange={(e) => setCardTotal(e.target.value)}
                placeholder="0.00"
                icon={<Icon name="pound" size={16} />}
                className={numberInputNoSpinnerClass}
                disabled={fieldsDisabled}
              />
            </Field>

            <Field label="Stripe total (dashboard)">
              <Input
                id="input-stripe-total"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={stripeTotal}
                onChange={(e) => setStripeTotal(e.target.value)}
                placeholder="0.00"
                icon={<Icon name="pound" size={16} />}
                className={numberInputNoSpinnerClass}
                disabled={fieldsDisabled}
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
                disabled={fieldsDisabled}
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
              {isReadOnlyStatus && !editMode ? (
                <Button
                  variant="secondary"
                  onClick={handleOpenForEditing}
                  disabled={isLockedStatus}
                  icon={<Icon name="edit" size={14} />}
                >
                  Edit takings
                </Button>
              ) : (
                <>
                  <Button variant="secondary" onClick={handleSave} loading={saving} disabled={fieldsDisabled}>
                    Save Draft
                  </Button>
                  <Button variant="primary" onClick={handleSubmit} loading={saving} disabled={fieldsDisabled}>
                    Submit
                  </Button>
                </>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Column 3 — Sales split */}
        <Card>
          <CardHeader
            title="Sales split"
            subtitle="Used for P&L health checks"
          />
          <CardBody className="space-y-4">
            <Field label="Drinks sales">
              <Input
                id="input-drinks-sales"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={drinksSales}
                onChange={(e) => setDrinksSales(e.target.value)}
                placeholder="0.00"
                icon={<Icon name="pound" size={16} />}
                className={numberInputNoSpinnerClass}
                disabled={fieldsDisabled}
              />
            </Field>

            <Field label="Food sales">
              <Input
                id="input-food-sales"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={foodSales}
                onChange={(e) => setFoodSales(e.target.value)}
                placeholder="0.00"
                icon={<Icon name="pound" size={16} />}
                className={numberInputNoSpinnerClass}
                disabled={fieldsDisabled}
              />
            </Field>

            <Field label="Other sales">
              <Input
                id="input-other-sales"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={otherSales}
                onChange={(e) => setOtherSales(e.target.value)}
                placeholder="0.00"
                icon={<Icon name="pound" size={16} />}
                className={numberInputNoSpinnerClass}
                disabled={fieldsDisabled}
              />
            </Field>

            <div className="rounded-default border border-border bg-surface-2 p-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-text-muted">Split total</span>
                <span className="font-mono font-semibold">£{fmt(salesSplitTotal)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-text-muted">Total revenue</span>
                <span className="font-mono font-semibold">£{fmt(totalRevenue)}</span>
              </div>
              <div className="mt-2 flex justify-between gap-3 border-t border-border pt-2">
                <span className="font-medium">Difference</span>
                <span className="font-mono font-bold text-text-strong">
                  £{fmt(salesSplitVariance)}
                </span>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Column 4 — Week at a glance */}
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
                      £{fmt(row.cash_counted_amount ?? 0)}
                    </TableCell>
                    <TableCell align="right" className="font-mono text-xs">
                      £{fmt(row.non_cash_counted_amount ?? 0)}
                    </TableCell>
                    <TableCell align="right" className="font-mono text-xs">
                      £{fmt(row.total_counted_amount ?? 0)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={statusTone(row.status)} dot>
                          {row.status}
                        </Badge>
                        <Button
                          variant="secondary"
                          size="xs"
                          onClick={() => router.push(cashupDateUrl(row.session_date, row.status !== 'locked'))}
                          disabled={row.status === 'locked'}
                          icon={<Icon name="edit" size={12} />}
                          aria-label={`Edit takings for ${format(parseISO(row.session_date), 'EEEE dd MMM')}`}
                          title="Edit takings"
                        >
                          Edit
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Revenue stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
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
        <Card>
          <CardBody>
            <Stat
              label="Split difference"
              value={`£${fmt(salesSplitVariance)}`}
              hint="For P&L reference"
            />
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
