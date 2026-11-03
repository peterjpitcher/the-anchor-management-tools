'use client'

import { useEffect, useState, useTransition } from 'react'
import { Button, Input, Modal, Textarea, toast } from '@/ds'
import { extendDueDate, unlockSection, waiveAssignment } from '@/app/actions/training'
import { formatTrainingDate } from '@/lib/training/labels'
import type { EmployeeAssignmentItem } from '@/lib/training/types'
import { FormError, useFormError } from '../FormError'
import { runTrainingAction } from '../run-action'

export type ItemDialogKind = 'extend' | 'waive' | 'unlock'

interface ItemDialogProps {
  kind: ItemDialogKind | null
  item: EmployeeAssignmentItem | null
  onClose: () => void
  /** Called after the change was saved, to reload the tab. */
  onDone: () => void
}

const COPY: Record<ItemDialogKind, { title: string; submit: string; field: string; hint: string; failed: string }> = {
  extend: {
    title: 'Extend Due Date',
    submit: 'Extend Due Date',
    field: 'Reason',
    hint: 'Saved in the training log. Never a health detail.',
    failed: 'The due date could not be moved. Try again.',
  },
  waive: {
    title: 'Waive Training',
    submit: 'Waive Training',
    field: 'Reason',
    hint: 'Saved in the training log with your name. Never a health detail.',
    failed: 'The training could not be waived. Try again.',
  },
  unlock: {
    title: 'Unlock Section',
    submit: 'Unlock Section',
    field: 'Note',
    hint: 'What you went through with them. Saved in the training log.',
    failed: 'The section could not be unlocked. Try again.',
  },
}

const FORM_ID = 'training-item-form'

function description(kind: ItemDialogKind, item: EmployeeAssignmentItem): string {
  const title = item.course.title
  if (kind === 'extend') {
    return item.assignment.dueOn
      ? `${title} is due ${formatTrainingDate(item.assignment.dueOn)}. A due date can only move later.`
      : `${title} has no due date yet. Set one with a reason.`
  }
  if (kind === 'waive') return `${title} will no longer be asked of them this time. The record keeps who waived it and why.`
  const section = item.sections.find((entry) => entry.key === item.assignment.lockedSection)
  return `${section ? `"${section.title}"` : 'The locked section'} gets three more tries, and the due date moves on by the days it was locked. Talk it through with them first.`
}

/** Extend a due date, waive an item or unlock a section: each needs a short reason or note. */
export function ItemDialog({ kind, item, onClose, onDone }: ItemDialogProps): React.JSX.Element {
  const [pending, startTransition] = useTransition()
  const [text, setText] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [error, setError] = useFormError()
  const open = kind !== null && item !== null
  const copy = kind ? COPY[kind] : COPY.extend

  useEffect(() => {
    if (!open) return
    setText('')
    setDueOn('')
    setError(null)
  }, [open, kind, item?.assignment.id])

  const close = (): void => {
    if (!pending) onClose()
  }

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!kind || !item) return
    const reason = text.trim()
    if (reason.length === 0) {
      setError(kind === 'unlock' ? 'Add a short note.' : 'Add a short reason.')
      return
    }
    if (kind === 'extend') {
      if (!dueOn) {
        setError('Choose the new due date.')
        return
      }
      if (item.assignment.dueOn && dueOn <= item.assignment.dueOn) {
        setError('The new due date must be later than the current one.')
        return
      }
    }
    setError(null)
    const assignmentId = item.assignment.id
    startTransition(async () => {
      const result =
        kind === 'extend'
          ? await runTrainingAction(() => extendDueDate({ assignmentId, dueOn, reason }), copy.failed)
          : kind === 'waive'
            ? await runTrainingAction(() => waiveAssignment({ assignmentId, reason }), copy.failed)
            : await runTrainingAction(() => unlockSection({ assignmentId, note: reason }), copy.failed)
      if (result.error) {
        setError(result.error)
        return
      }
      toast.success(
        kind === 'extend'
          ? `Due date moved to ${formatTrainingDate(dueOn)}.`
          : kind === 'waive'
            ? `${item.course.title} waived.`
            : 'Section unlocked.',
      )
      onDone()
    })
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={copy.title}
      description={kind && item ? description(kind, item) : undefined}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={pending}>
            {copy.submit}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} className="space-y-4">
        <FormError error={error} />
        {kind === 'extend' ? (
          <Input
            type="date"
            label="New Due Date"
            value={dueOn}
            min={item?.assignment.dueOn ?? undefined}
            onChange={(event) => setDueOn(event.target.value)}
          />
        ) : null}
        <Textarea label={copy.field} hint={copy.hint} value={text} maxLength={500} onChange={(event) => setText(event.target.value)} />
      </form>
    </Modal>
  )
}
