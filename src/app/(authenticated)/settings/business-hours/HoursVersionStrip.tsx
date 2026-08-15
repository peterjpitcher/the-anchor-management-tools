'use client'

import { useCallback, useState, useTransition } from 'react'
import toast from 'react-hot-toast'
import { Alert, Button, Field, Input, Modal } from '@/ds'
import { formatDateInLondon } from '@/lib/dateUtils'
import {
  createScheduledHoursVersion,
  publishHoursVersion,
  withdrawHoursVersion,
  type HoursVersionSummary,
} from '@/app/actions/business-hours'

interface HoursVersionStripProps {
  versions: HoursVersionSummary[]
  selectedId: string | null
  onSelect: (versionId: string) => void
  canManage: boolean
  onChanged: () => void
}

function longDate(iso: string): string {
  return formatDateInLondon(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * Version picker for the weekly schedule.
 *
 * The wording here matters more than it looks. A published future version is not
 * a draft and not "pending": it already decides what a customer is offered for
 * any date on or after it, months before it becomes this week's hours. Saying
 * "not live yet" would be false, and someone would schedule a change believing
 * they could still think about it.
 */
export function HoursVersionStrip({
  versions,
  selectedId,
  onSelect,
  canManage,
  onChanged,
}: HoursVersionStripProps) {
  const [creating, setCreating] = useState(false)
  const [newDate, setNewDate] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [showPast, setShowPast] = useState(false)
  const [pending, startTransition] = useTransition()

  const today = new Date().toISOString().slice(0, 10)
  const future = versions.filter(v => v.effectiveFrom > today && v.status !== 'withdrawn')
  const current = versions.filter(v => v.isActive)
  const past = versions.filter(v => !v.isActive && v.effectiveFrom <= today)

  const selected = versions.find(v => v.id === selectedId) ?? null

  const handleCreate = useCallback(() => {
    startTransition(async () => {
      const result = await createScheduledHoursVersion(newDate, newLabel)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Scheduled change created as a draft')
      setCreating(false)
      setNewDate('')
      setNewLabel('')
      if (result.data) onSelect(result.data.id)
      onChanged()
    })
  }, [newDate, newLabel, onSelect, onChanged])

  const handlePublish = useCallback(
    (version: HoursVersionSummary) => {
      const confirmed = window.confirm(
        `Publish the schedule starting ${longDate(version.effectiveFrom)}?\n\n` +
          'From the moment you publish, bookings on or after that date are checked against these hours, ' +
          'and the website will show them as the hours for those dates. It does not wait until the date arrives.',
      )
      if (!confirmed) return

      startTransition(async () => {
        const result = await publishHoursVersion(version.id)
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success('Schedule published')
        onChanged()
      })
    },
    [onChanged],
  )

  const handleWithdraw = useCallback(
    (version: HoursVersionSummary) => {
      const confirmed = window.confirm(
        `Withdraw the schedule starting ${longDate(version.effectiveFrom)}?\n\n` +
          'Those dates go back to the hours that applied before it.',
      )
      if (!confirmed) return

      startTransition(async () => {
        const result = await withdrawHoursVersion(version.id)
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success('Schedule withdrawn')
        onChanged()
      })
    },
    [onChanged],
  )

  const renderTab = (version: HoursVersionSummary) => {
    const isSelected = version.id === selectedId
    const name = version.isActive
      ? 'Current hours'
      : `From ${formatDateInLondon(version.effectiveFrom, { day: 'numeric', month: 'long', year: 'numeric' })}`

    return (
      <button
        key={version.id}
        type="button"
        role="tab"
        aria-selected={isSelected}
        onClick={() => onSelect(version.id)}
        className={`min-h-[44px] rounded-md border px-3 py-2 text-sm font-medium ${
          isSelected
            ? 'border-sidebar bg-sidebar text-white'
            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
        }`}
      >
        {name}
        {version.status === 'draft' && (
          <span className={`ml-2 text-xs ${isSelected ? 'text-white/80' : 'text-gray-500'}`}>Draft</span>
        )}
      </button>
    )
  }

  return (
    <div className="space-y-3 border-b border-gray-200 p-4">
      <div role="tablist" aria-label="Opening-hours schedules" className="flex flex-wrap gap-2">
        {current.map(renderTab)}
        {future.map(renderTab)}
        {showPast && past.map(renderTab)}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {canManage && (
          <Button type="button" variant="secondary" onClick={() => setCreating(true)} disabled={pending}>
            Schedule a change
          </Button>
        )}
        {past.length > 0 && (
          <button
            type="button"
            onClick={() => setShowPast(v => !v)}
            className="text-sm text-gray-600 underline"
          >
            {showPast ? 'Hide' : 'Show'} {past.length} past schedule{past.length === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {selected?.status === 'draft' && (
        <Alert variant="info" title="Draft, not in use">
          <p>
            These hours have no effect on anything until you publish them. Nobody is offered them and
            nothing is checked against them.
          </p>
          {canManage && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" onClick={() => handlePublish(selected)} disabled={pending}>
                Publish this schedule
              </Button>
              <Button type="button" variant="secondary" onClick={() => handleWithdraw(selected)} disabled={pending}>
                Discard
              </Button>
            </div>
          )}
        </Alert>
      )}

      {selected?.status === 'published' && !selected.isActive && selected.effectiveFrom > today && (
        <Alert variant="warning" title={`In use for dates from ${longDate(selected.effectiveFrom)}`}>
          <p>
            These hours already apply to any booking on or after that date, and the website shows them
            for those dates. They are not waiting for the date to arrive.
          </p>
          {canManage && (
            <div className="mt-3">
              <Button type="button" variant="secondary" onClick={() => handleWithdraw(selected)} disabled={pending}>
                Withdraw
              </Button>
            </div>
          )}
        </Alert>
      )}

      {selected?.isBaseline && (
        <Alert variant="info" title="Historic record">
          <p>
            This is the schedule as it stood when scheduled changes were introduced. It covers every
            date before the first scheduled change. It is not a record of the hours actually worked
            further back than that.
          </p>
        </Alert>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Schedule a change">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            This copies the hours that apply the day before your chosen date, so you only change what
            is different. It is saved as a draft and does nothing until you publish it.
          </p>
          <Field label="First day these hours apply" required>
            <Input
              type="date"
              value={newDate}
              min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
              onChange={e => setNewDate(e.target.value)}
            />
          </Field>
          <Field label="Name (optional)" help="Something to recognise it by, for example: autumn hours">
            <Input value={newLabel} onChange={e => setNewLabel(e.target.value)} maxLength={80} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleCreate} disabled={!newDate || pending}>
              Create draft
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
