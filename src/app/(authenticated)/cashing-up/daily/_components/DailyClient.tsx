'use client'

import { useState, useCallback } from 'react'
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
  // Extract initial values from existing session breakdowns
  const getBreakdownValue = (code: string, field: 'countedAmount' | 'expectedAmount'): number => {
    if (!existingSession?.cashup_payment_breakdowns) return 0
    const bd = existingSession.cashup_payment_breakdowns.find(
      (b) => b.payment_type_code === code
    )
    if (!bd) return 0
    return field === 'countedAmount' ? bd.counted_amount : bd.expected_amount
  }

  const [cashCounted, setCashCounted] = useState(getBreakdownValue('CASH', 'countedAmount').toString() || '')
  const [floatOpened, setFloatOpened] = useState('')
  const [cardTakings, setCardTakings] = useState(getBreakdownValue('CARD', 'countedAmount').toString() || '')
  const [tipsOnCard, setTipsOnCard] = useState('')
  const [refunds, setRefunds] = useState('')
  const [voids, setVoids] = useState('')
  const [notes, setNotes] = useState(existingSession?.notes || '')
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(existingSession?.id ?? null)

  const cashNum = parseFloat(cashCounted) || 0
  const cardNum = parseFloat(cardTakings) || 0
  const tipsNum = parseFloat(tipsOnCard) || 0
  const refundsNum = parseFloat(refunds) || 0
  const voidsNum = parseFloat(voids) || 0
  const floatNum = parseFloat(floatOpened) || 0

  const totalCounted = cashNum + cardNum + tipsNum - refundsNum - voidsNum
  const target = dailyTarget
  const variance = totalCounted - target

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const dto: UpsertCashupSessionDTO = {
        siteId,
        sessionDate,
        status: 'draft',
        notes: notes || null,
        paymentBreakdowns: [
          { paymentTypeCode: 'CASH', paymentTypeLabel: 'Cash', expectedAmount: target, countedAmount: cashNum },
          { paymentTypeCode: 'CARD', paymentTypeLabel: 'Card', expectedAmount: cardNum, countedAmount: cardNum },
          { paymentTypeCode: 'TIPS', paymentTypeLabel: 'Tips on Card', expectedAmount: 0, countedAmount: tipsNum },
        ],
        cashCounts: [],
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
  }, [siteId, sessionDate, notes, cashNum, cardNum, tipsNum, target, sessionId])

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

  return (
    <div className="space-y-4">
      {/* 2-column grid layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left column - Today's till */}
        <Card>
          <CardHeader
            title="Today's till"
            subtitle={lastSaved ? `Auto-saved at ${lastSaved}` : sessionDate}
          />
          <CardBody>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cash drawer (counted)">
                <Input
                  type="number"
                  step="0.01"
                  value={cashCounted}
                  onChange={(e) => setCashCounted(e.target.value)}
                  placeholder="0.00"
                  icon={<Icon name="pound" size={16} />}
                />
              </Field>
              <Field label="Float opened with">
                <Input
                  type="number"
                  step="0.01"
                  value={floatOpened}
                  onChange={(e) => setFloatOpened(e.target.value)}
                  placeholder="0.00"
                  icon={<Icon name="pound" size={16} />}
                />
              </Field>
              <Field label="Card takings (Stripe)">
                <Input
                  type="number"
                  step="0.01"
                  value={cardTakings}
                  onChange={(e) => setCardTakings(e.target.value)}
                  placeholder="0.00"
                  icon={<Icon name="pound" size={16} />}
                />
              </Field>
              <Field label="Tips on card">
                <Input
                  type="number"
                  step="0.01"
                  value={tipsOnCard}
                  onChange={(e) => setTipsOnCard(e.target.value)}
                  placeholder="0.00"
                  icon={<Icon name="pound" size={16} />}
                />
              </Field>
              <Field label="Refunds">
                <Input
                  type="number"
                  step="0.01"
                  value={refunds}
                  onChange={(e) => setRefunds(e.target.value)}
                  placeholder="0.00"
                  icon={<Icon name="pound" size={16} />}
                />
              </Field>
              <Field label="Voids">
                <Input
                  type="number"
                  step="0.01"
                  value={voids}
                  onChange={(e) => setVoids(e.target.value)}
                  placeholder="0.00"
                  icon={<Icon name="pound" size={16} />}
                />
              </Field>
            </div>

            {/* Notes */}
            <div className="mt-3">
              <Field label="Notes">
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any notes for today..."
                />
              </Field>
            </div>

            {/* Variance alert */}
            <div className="mt-4">
              <Alert tone="info">
                <div className="flex justify-between items-center">
                  <span>Total counted: <strong>{'£'}{fmt(totalCounted)}</strong></span>
                  <span>
                    Variance: <strong className={variance >= 0 ? 'text-success-fg' : 'text-danger-fg'}>
                      {'£'}{fmt(variance)}
                    </strong>
                  </span>
                </div>
              </Alert>
            </div>

            {/* Buttons */}
            <div className="flex gap-3 mt-4">
              <Button variant="secondary" onClick={handleSave} loading={saving}>
                Save Draft
              </Button>
              <Button variant="primary" onClick={handleSubmit} loading={saving}>
                Submit
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* Right column - Week at a glance */}
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
                      {'£'}{fmt(row.total_expected_amount ?? 0)}
                    </TableCell>
                    <TableCell align="right" className="font-mono text-xs">
                      {'£'}{fmt(row.total_counted_amount ?? 0)}
                    </TableCell>
                    <TableCell align="right" className="font-mono text-xs">
                      {'£'}{fmt((row.total_expected_amount ?? 0) + (row.total_counted_amount ?? 0))}
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

      {/* Category breakdown stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardBody>
            <Stat label="Cash" value={`£${fmt(cashNum)}`} />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat label="Card" value={`£${fmt(cardNum)}`} />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat label="Tips" value={`£${fmt(tipsNum)}`} />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat label="Refunds / Voids" value={`£${fmt(refundsNum + voidsNum)}`} />
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
