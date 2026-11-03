'use client'

import { useEffect, useState, useTransition } from 'react'
import { Button, Checkbox, Fieldset, Input, Modal, Select, Textarea, toast } from '@/ds'
import { pauseTraining, setTrainingAdjustmentNote, setTrainingGroups } from '@/app/actions/training'
import { TRAINING_GROUP_BADGE, TRAINING_PAUSE_REASON_BADGE, trainingGroupsText } from '@/lib/training/labels'
import { TRAINING_GROUPS, TRAINING_PAUSE_REASONS, type PauseReason, type TrainingGroup } from '@/lib/training/types'
import { FormError, useFormError } from '../FormError'
import { runTrainingAction } from '../run-action'

interface GroupsDialogProps {
  open: boolean
  employeeId: string
  employeeName: string
  /** The groups training uses today (confirmed, or suggested until confirmed). */
  current: TrainingGroup[]
  suggested: TrainingGroup[]
  onClose: () => void
  onDone: () => void
}

const GROUPS_FORM_ID = 'training-groups-form'

/** Confirm a person's training groups. Confirming none is allowed and means "no groups". */
export function GroupsDialog({ open, employeeId, employeeName, current, suggested, onClose, onDone }: GroupsDialogProps): React.JSX.Element {
  const [pending, startTransition] = useTransition()
  const [groups, setGroups] = useState<Set<TrainingGroup>>(new Set(current))
  const [error, setError] = useFormError()

  useEffect(() => {
    if (!open) return
    setGroups(new Set(current))
    setError(null)
  }, [open, current])

  const close = (): void => {
    if (!pending) onClose()
  }

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const chosen = TRAINING_GROUPS.filter((group) => groups.has(group))
    startTransition(async () => {
      const result = await runTrainingAction(
        () => setTrainingGroups({ employeeId, groups: chosen, confirm: true }),
        'The groups could not be saved. Try again.',
      )
      if (result.error) {
        setError(result.error)
        return
      }
      const changed = result.data ? result.data.sync.created + result.data.sync.cancelled : 0
      toast.success(changed > 0 ? `Groups confirmed. ${changed} training items changed.` : 'Groups confirmed.')
      onDone()
    })
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Training Groups"
      description={`Which parts of the pub ${employeeName} works in. Courses for a group are given to everyone in it while automatic assignment is on.`}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={GROUPS_FORM_ID} variant="primary" loading={pending}>
            Confirm Groups
          </Button>
        </>
      }
    >
      <form id={GROUPS_FORM_ID} onSubmit={submit} className="space-y-4">
        <FormError error={error} />
        <Fieldset
          legend="Groups"
          hint={`Suggested from their job title and recent rota: ${suggested.length > 0 ? trainingGroupsText(suggested) : 'none'}.`}
        >
          <div className="grid gap-1 sm:grid-cols-2">
            {TRAINING_GROUPS.map((group) => (
              <Checkbox
                key={group}
                label={TRAINING_GROUP_BADGE[group].label}
                checked={groups.has(group)}
                onChange={(checked) =>
                  setGroups((existing) => {
                    const next = new Set(existing)
                    if (checked) next.add(group)
                    else next.delete(group)
                    return next
                  })
                }
              />
            ))}
          </div>
        </Fieldset>
      </form>
    </Modal>
  )
}

interface PauseDialogProps {
  open: boolean
  employeeId: string
  employeeName: string
  today: string
  onClose: () => void
  onDone: () => void
}

const PAUSE_FORM_ID = 'training-pause-form'

/** Pause someone's training (leave, parental leave, other). Chasing stops until it ends. */
export function PauseDialog({ open, employeeId, employeeName, today, onClose, onDone }: PauseDialogProps): React.JSX.Element {
  const [pending, startTransition] = useTransition()
  const [from, setFrom] = useState(today)
  const [until, setUntil] = useState('')
  const [reason, setReason] = useState<PauseReason | ''>('')
  const [error, setError] = useFormError()

  useEffect(() => {
    if (!open) return
    setFrom(today)
    setUntil('')
    setReason('')
    setError(null)
  }, [open, today])

  const close = (): void => {
    if (!pending) onClose()
  }

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!from) {
      setError('Choose when the pause starts.')
      return
    }
    if (until && until < from) {
      setError('The pause cannot end before it starts.')
      return
    }
    if (!reason) {
      setError('Choose a reason.')
      return
    }
    setError(null)
    const chosenReason = reason
    startTransition(async () => {
      const result = await runTrainingAction(
        () => pauseTraining({ employeeId, from, until: until || null, reason: chosenReason }),
        'Training could not be paused. Try again.',
      )
      if (result.error) {
        setError(result.error)
        return
      }
      toast.success('Training paused. Nobody is chased while it lasts.')
      onDone()
    })
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Pause Training"
      description={`Nothing is due and nobody chases ${employeeName} while the pause lasts. Due dates move on when it ends.`}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={PAUSE_FORM_ID} variant="primary" loading={pending}>
            Pause Training
          </Button>
        </>
      }
    >
      <form id={PAUSE_FORM_ID} onSubmit={submit} className="space-y-4">
        <FormError error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input type="date" label="From" value={from} onChange={(event) => setFrom(event.target.value)} />
          <Input
            type="date"
            label="Until"
            hint="Leave empty to pause until you resume it."
            value={until}
            min={from || undefined}
            onChange={(event) => setUntil(event.target.value)}
          />
        </div>
        <Select
          label="Reason"
          hint="Choose from the list. Never record a health detail."
          value={reason}
          placeholder="Choose a reason"
          onChange={(event) => setReason(event.target.value as PauseReason | '')}
          options={TRAINING_PAUSE_REASONS.map((value) => ({ value, label: TRAINING_PAUSE_REASON_BADGE[value].label }))}
        />
      </form>
    </Modal>
  )
}

interface AdjustmentDialogProps {
  open: boolean
  employeeId: string
  employeeName: string
  /** The adjustment recorded now, or null. */
  current: string | null
  onClose: () => void
  onDone: () => void
}

const ADJUSTMENT_FORM_ID = 'training-adjustment-form'
/** The most the profile keeps (training_profiles.adjustment_note). */
const ADJUSTMENT_MAX_CHARS = 300

/**
 * Record the adjustment someone's training uses (for example "read aloud offered"). The
 * adjustment only, never the health reason behind it. Saving it empty clears it.
 */
export function AdjustmentDialog({ open, employeeId, employeeName, current, onClose, onDone }: AdjustmentDialogProps): React.JSX.Element {
  const [pending, startTransition] = useTransition()
  const [note, setNote] = useState(current ?? '')
  const [error, setError] = useFormError()

  useEffect(() => {
    if (!open) return
    setNote(current ?? '')
    setError(null)
  }, [open, current])

  const close = (): void => {
    if (!pending) onClose()
  }

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const trimmed = note.trim()
    if (trimmed.length > ADJUSTMENT_MAX_CHARS) {
      setError(`Keep the adjustment under ${ADJUSTMENT_MAX_CHARS} characters.`)
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await runTrainingAction(
        () => setTrainingAdjustmentNote({ employeeId, note: trimmed.length > 0 ? trimmed : null }),
        'The adjustment could not be saved. Try again.',
      )
      if (result.error) {
        setError(result.error)
        return
      }
      toast.success(trimmed.length > 0 ? 'Adjustment saved.' : 'Adjustment cleared.')
      onDone()
    })
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Training Adjustment"
      description={`How ${employeeName}'s training is adjusted, so every manager offers the same.`}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={ADJUSTMENT_FORM_ID} variant="primary" loading={pending}>
            Save Adjustment
          </Button>
        </>
      }
    >
      <form id={ADJUSTMENT_FORM_ID} onSubmit={submit} className="space-y-4">
        <FormError error={error} />
        <Textarea
          label="Adjustment"
          hint="For example, read aloud offered. Write the adjustment only, never a health detail. Leave empty to clear it."
          value={note}
          maxLength={ADJUSTMENT_MAX_CHARS}
          onChange={(event) => setNote(event.target.value)}
        />
      </form>
    </Modal>
  )
}
