'use client'

import { useCallback, useState, useTransition } from 'react'
import { Alert, Button, CardBody, ConfirmDialog, Field, FormFooter, Input, Modal, Tabs, toast } from '@/ds'
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
  const [confirming, setConfirming] = useState<{ kind: 'publish' | 'withdraw'; version: HoursVersionSummary } | null>(null)

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

  const tabLabel = (version: HoursVersionSummary): string => {
    const name = version.isActive
      ? 'Current Hours'
      : `From ${formatDateInLondon(version.effectiveFrom, { day: 'numeric', month: 'long', year: 'numeric' })}`
    return version.status === 'draft' ? `${name} (Draft)` : name
  }

  const shownVersions = [...current, ...future, ...(showPast ? past : [])]

  return (
    <CardBody className="space-y-3 border-b border-border">
      <div role="group" aria-label="Opening-hours schedules">
        <Tabs
          tabs={shownVersions.map(version => ({ id: version.id, label: tabLabel(version) }))}
          activeTab={selectedId ?? ''}
          onTabChange={onSelect}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {canManage && (
          <Button type="button" variant="secondary" onClick={() => setCreating(true)} disabled={pending}>
            Schedule a Change
          </Button>
        )}
        {past.length > 0 && (
          <Button type="button" variant="link" size="sm" onClick={() => setShowPast(v => !v)}>
            {showPast ? 'Hide' : 'Show'} {past.length} Past Schedule{past.length === 1 ? '' : 's'}
          </Button>
        )}
      </div>

      {selected?.status === 'draft' && (
        <Alert tone="info" title="Draft, not in use">
          <p>
            These hours have no effect on anything until you publish them. Nobody is offered them and
            nothing is checked against them.
          </p>
          {canManage && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirming({ kind: 'withdraw', version: selected })}
                disabled={pending}
              >
                Discard
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => setConfirming({ kind: 'publish', version: selected })}
                disabled={pending}
              >
                Publish This Schedule
              </Button>
            </div>
          )}
        </Alert>
      )}

      {selected?.status === 'published' && !selected.isActive && selected.effectiveFrom > today && (
        <Alert tone="warning" title={`In use for dates from ${longDate(selected.effectiveFrom)}`}>
          <p>
            These hours already apply to any booking on or after that date, and the website shows them
            for those dates. They are not waiting for the date to arrive.
          </p>
          {canManage && (
            <div className="mt-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirming({ kind: 'withdraw', version: selected })}
                disabled={pending}
              >
                Withdraw
              </Button>
            </div>
          )}
        </Alert>
      )}

      {selected?.isBaseline && (
        <Alert tone="info" title="Historic record">
          <p>
            This is the schedule as it stood when scheduled changes were introduced. It covers every
            date before the first scheduled change. It is not a record of the hours actually worked
            further back than that.
          </p>
        </Alert>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Schedule a Change">
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
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
          <FormFooter>
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={handleCreate} disabled={!newDate || pending}>
              Create Draft
            </Button>
          </FormFooter>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (!confirming) return
          if (confirming.kind === 'publish') handlePublish(confirming.version)
          else handleWithdraw(confirming.version)
        }}
        tone={confirming?.kind === 'publish' ? 'warning' : 'danger'}
        title={confirming?.kind === 'publish' ? 'Publish Schedule' : 'Withdraw Schedule'}
        confirmLabel={confirming?.kind === 'publish' ? 'Publish' : 'Withdraw'}
        message={
          confirming ? (
            confirming.kind === 'publish' ? (
              <>
                <span className="block">Publish the schedule starting {longDate(confirming.version.effectiveFrom)}?</span>
                <span className="mt-2 block">
                  From the moment you publish, bookings on or after that date are checked against these hours,
                  and the website will show them as the hours for those dates. It does not wait until the date arrives.
                </span>
              </>
            ) : (
              <>
                <span className="block">Withdraw the schedule starting {longDate(confirming.version.effectiveFrom)}?</span>
                <span className="mt-2 block">Those dates go back to the hours that applied before it.</span>
              </>
            )
          ) : undefined
        }
      />
    </CardBody>
  )
}
