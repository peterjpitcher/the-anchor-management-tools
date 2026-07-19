'use client'

import { useState } from 'react'
import { Button, Badge, Field, Input, Textarea, Alert } from '@/ds'
import { Icon } from '@/ds/icons'
import toast from 'react-hot-toast'
import { formatDateTime12Hour } from '@/lib/dateUtils'
import { completeChecklistInstance, undoChecklistInstance } from '@/app/actions/checklists'
import type { ChecklistTaskView } from '@/app/actions/checklists'
import type { Identity } from './AttributionPicker'

const UNDO_WINDOW_MS = 15 * 60 * 1000

function rangeHint(task: ChecklistTaskView): string | undefined {
  const { valueMin: min, valueMax: max, valueUnit: unit } = task
  const u = unit ? ` ${unit}` : ''
  if (min != null && max != null) return `Acceptable range: ${min} to ${max}${u}`
  if (min != null) return `Acceptable range: ${min}${u} or above`
  if (max != null) return `Acceptable range: ${max}${u} or below`
  return undefined
}

interface TaskRowProps {
  task: ChecklistTaskView
  identity: Identity | null
  onChanged: () => void
  onNeedIdentity: () => void
}

export function TaskRow({ task, identity, onChanged, onNeedIdentity }: TaskRowProps) {
  const [value, setValue] = useState('')
  const [notes, setNotes] = useState('')
  const [showNotes, setShowNotes] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const isActionable = task.state === 'pending' && !task.locked

  async function handleDone() {
    if (!identity) {
      toast.error('Choose who you are first')
      onNeedIdentity()
      return
    }

    let numValue: number | undefined
    if (task.requiresValue) {
      if (value.trim() === '') {
        toast.error('Enter a reading first')
        return
      }
      const parsed = Number(value)
      if (Number.isNaN(parsed)) {
        toast.error('Enter a valid number')
        return
      }
      // Typo guard: only when both bounds exist. Confirm once if the reading is
      // more than 10x the band outside it. A reading is never silently rejected.
      if (task.valueMin != null && task.valueMax != null) {
        const band = task.valueMax - task.valueMin
        const low = task.valueMin - 10 * band
        const high = task.valueMax + 10 * band
        if (parsed < low || parsed > high) {
          if (!window.confirm('That reading looks unusual, is it correct?')) return
        }
      }
      numValue = parsed
    }

    setSubmitting(true)
    const res = await completeChecklistInstance({
      instanceId: task.id,
      employeeId: identity.employeeId,
      value: numValue,
      notes: notes.trim() || null,
    })
    setSubmitting(false)

    if (res.alreadyDone) {
      toast('Already done by someone else')
      onChanged()
      return
    }
    if (res.error) {
      toast.error(res.error)
      return
    }
    if (res.breach) toast.error('Out of range, contact Billy or Peter')
    else toast.success(`Done, ${identity.name}`)
    onChanged()
  }

  async function handleUndo() {
    if (!identity) return
    setSubmitting(true)
    const res = await undoChecklistInstance({ instanceId: task.id, employeeId: identity.employeeId })
    setSubmitting(false)
    if (res.error) {
      toast.error(res.error)
      return
    }
    toast.success('Undone')
    onChanged()
  }

  // Completed
  if (task.state === 'done') {
    const canUndo =
      !task.locked &&
      identity?.employeeId === task.completedByEmployeeId &&
      task.completedAt != null &&
      Date.now() - new Date(task.completedAt).getTime() < UNDO_WINDOW_MS

    return (
      <div className="rounded-md border border-border p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Icon name="check" size={16} className="shrink-0 text-success-fg" />
              <span className="text-sm font-medium">{task.title}</span>
              {task.wasLate && <Badge tone="warning">Late</Badge>}
            </div>
            <p className="mt-1 text-xs text-muted">
              Done by {task.completedByName ?? 'someone'}
              {task.completedAt ? `, ${formatDateTime12Hour(task.completedAt)}` : ''}
            </p>
            {task.valueRecorded != null && (
              <p className="mt-1 text-xs text-subtle">
                Reading: {task.valueRecorded}
                {task.valueUnit ? ` ${task.valueUnit}` : ''}
              </p>
            )}
            {task.notes && <p className="mt-1 text-xs text-subtle">Note: {task.notes}</p>}
            {task.valueBreach && (
              <div className="mt-2">
                <Alert
                  variant="danger"
                  icon={<Icon name="alertTriangle" size={16} />}
                  title="Out of range"
                >
                  Contact Billy or Peter.
                </Alert>
              </div>
            )}
          </div>
          {canUndo && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleUndo}
              loading={submitting}
              disabled={submitting}
            >
              Undo
            </Button>
          )}
        </div>
      </div>
    )
  }

  // Missed / skipped / not applicable / locked-pending (read-only)
  if (!isActionable) {
    const label =
      task.state === 'missed'
        ? 'Missed'
        : task.state === 'skipped'
          ? 'Skipped'
          : task.state === 'not_applicable'
            ? 'Not applicable'
            : 'Locked'
    const tone: 'danger' | 'neutral' = task.state === 'missed' ? 'danger' : 'neutral'
    return (
      <div className="rounded-md border border-border p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-sm text-muted">{task.title}</span>
          <Badge tone={tone}>{label}</Badge>
        </div>
      </div>
    )
  }

  // Pending and actionable
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-sm font-medium">{task.title}</div>
      {task.instruction && <p className="mt-1 text-xs text-muted">{task.instruction}</p>}

      {task.requiresValue && (
        <div className="mt-3 max-w-xs">
          <Field
            label={`Reading${task.valueUnit ? ` (${task.valueUnit})` : ''}`}
            required
            hint={rangeHint(task)}
          >
            <Input
              type="number"
              step="0.1"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={submitting}
            />
          </Field>
        </div>
      )}

      {showNotes ? (
        <div className="mt-3">
          <Textarea
            label="Note (optional)"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={submitting}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowNotes(true)}
          className="mt-2 text-xs text-primary"
        >
          Add a note
        </button>
      )}

      <div className="mt-3">
        <Button
          variant="primary"
          size="lg"
          onClick={handleDone}
          loading={submitting}
          disabled={submitting}
        >
          Done
        </Button>
      </div>
    </div>
  )
}
