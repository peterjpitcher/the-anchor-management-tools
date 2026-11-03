'use client'

import { useState, useTransition } from 'react'
import { Button, Checkbox, Fieldset, Input, Modal, toast } from '@/ds'
import { createExternalCourse } from '@/app/actions/training-courses'
import { TRAINING_GROUP_BADGE } from '@/lib/training/labels'
import { TRAINING_GROUPS, type TrainingGroup } from '@/lib/training/types'
import { FormError, useFormError } from './FormError'
import { runTrainingAction } from './run-action'

interface NewExternalCourseDialogProps {
  open: boolean
  onClose: () => void
  onCreated: (slug: string) => void
}

const FORM_ID = 'new-external-qualification-form'

/**
 * New External Qualification: a type such as Level 2 Food Hygiene or a personal licence. It is
 * live straight away. Managers record each person's certificate on their Training tab.
 */
export function NewExternalCourseDialog({ open, onClose, onCreated }: NewExternalCourseDialogProps): React.JSX.Element {
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState('')
  const [refresherMonths, setRefresherMonths] = useState('')
  const [groups, setGroups] = useState<Set<TrainingGroup>>(new Set())
  const [required, setRequired] = useState(false)
  const [error, setError] = useFormError()

  const reset = (): void => {
    setTitle('')
    setRefresherMonths('')
    setGroups(new Set())
    setRequired(false)
    setError(null)
  }

  const close = (): void => {
    if (pending) return
    reset()
    onClose()
  }

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const trimmed = title.trim()
    if (trimmed.length < 2) {
      setError('Give the qualification a name.')
      return
    }
    let months: number | null = null
    if (refresherMonths.trim() !== '') {
      months = Number(refresherMonths)
      if (!Number.isInteger(months) || months < 1 || months > 120) {
        setError('Renewal must be a whole number of months from 1 to 120, or left empty.')
        return
      }
    }
    setError(null)
    startTransition(async () => {
      const result = await runTrainingAction(
        () =>
          createExternalCourse({
            title: trimmed,
            refresherMonths: months,
            groups: TRAINING_GROUPS.filter((group) => groups.has(group)),
            required,
          }),
        'The qualification could not be added. Try again.',
      )
      if (result.error || !result.data) {
        setError(result.error ?? 'The qualification could not be added. Try again.')
        return
      }
      toast.success(`${trimmed} added.`)
      reset()
      onCreated(result.data.slug)
    })
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="New External Qualification"
      description="A certificate from an outside provider, recorded by a manager with its file."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={pending}>
            Create Qualification
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} className="space-y-4">
        <FormError error={error} />
        <Input label="Name" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Level 2 Food Hygiene" />
        <Input
          label="Renew Every (Months)"
          type="number"
          inputMode="numeric"
          min={1}
          max={120}
          value={refresherMonths}
          hint="Leave empty if it never needs renewing. The expiry on each certificate is what counts."
          onChange={(event) => setRefresherMonths(event.target.value)}
        />
        <Fieldset legend="Who Needs It" hint="Tick none for everyone.">
          <div className="grid gap-1 sm:grid-cols-2">
            {TRAINING_GROUPS.map((group) => (
              <Checkbox
                key={group}
                label={TRAINING_GROUP_BADGE[group].label}
                checked={groups.has(group)}
                onChange={(checked) =>
                  setGroups((current) => {
                    const next = new Set(current)
                    if (checked) next.add(group)
                    else next.delete(group)
                    return next
                  })
                }
              />
            ))}
          </div>
        </Fieldset>
        <Checkbox
          label="Required"
          description="Show it as outstanding for everyone it applies to while automatic assignment is on. Leave unticked to record it by hand only."
          checked={required}
          onChange={setRequired}
        />
      </form>
    </Modal>
  )
}
