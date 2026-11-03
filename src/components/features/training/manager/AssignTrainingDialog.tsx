'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Alert, Button, Checkbox, Fieldset, Input, Modal, PageLoading, Select, Textarea, toast } from '@/ds'
import { assignCourse, getTrainingMatrix, type AssignCourseResult } from '@/app/actions/training'
import type { CourseRef } from '@/lib/training/types'
import { FormError, useFormError } from './FormError'
import { runTrainingAction } from './run-action'

interface AssignablePerson {
  employeeId: string
  name: string
}

interface AssignTrainingDialogProps {
  open: boolean
  onClose: () => void
  /** Courses to choose from. Left out: the live courses on the matrix. */
  courses?: CourseRef[]
  /** People to choose from. Left out (and no `fixedEmployee`): the people on the matrix. */
  people?: AssignablePerson[]
  /** The employee record: one person, so no list of people is shown. */
  fixedEmployee?: AssignablePerson
  /** Called after at least one cycle was created. */
  onAssigned?: () => void
}

const FORM_ID = 'assign-training-form'

const SKIP_REASON_TEXT: Record<AssignCourseResult['skipped'][number]['reason'], string> = {
  already_open: 'already has it open',
  not_in_scope: 'is not an active member of staff',
  not_applicable: 'is not in the course audience',
  under_minimum_age: 'is younger than the minimum age for this course',
  dob_missing: 'has no date of birth on their employee record, and this course has an age rule',
}

function describeResult(result: AssignCourseResult, names: Map<string, string>): string {
  const assigned = result.created === 1 ? 'Assigned to 1 person.' : `Assigned to ${result.created} people.`
  if (result.skipped.length === 0) return assigned
  const skipped = result.skipped
    .slice(0, 3)
    .map((skip) => `${names.get(skip.employeeId) ?? 'Someone'} ${SKIP_REASON_TEXT[skip.reason]}`)
    .join('; ')
  const more = result.skipped.length > 3 ? ` and ${result.skipped.length - 3} more` : ''
  return `${assigned} Not assigned: ${skipped}${more}.`
}

/**
 * Assign Training: one course to one or more people, with an optional due date. Anyone who
 * already has the course open is skipped and named, never given a second open cycle.
 */
export function AssignTrainingDialog({
  open,
  onClose,
  courses: givenCourses,
  people: givenPeople,
  fixedEmployee,
  onAssigned,
}: AssignTrainingDialogProps): React.JSX.Element {
  const [pending, startTransition] = useTransition()
  const [loaded, setLoaded] = useState<{ courses: CourseRef[]; people: AssignablePerson[] } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [courseId, setCourseId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dueOn, setDueOn] = useState('')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useFormError()

  const needsLoad = open && (!givenCourses || (!givenPeople && !fixedEmployee))

  useEffect(() => {
    if (!needsLoad || loaded) return
    let cancelled = false
    void runTrainingAction(() => getTrainingMatrix(), 'The courses and people could not be loaded.').then((result) => {
      if (cancelled) return
      if (result.error || !result.data) {
        setLoadError(result.error ?? 'The courses and people could not be loaded.')
        return
      }
      setLoadError(null)
      setLoaded({
        courses: result.data.courses.map((course) => ({ id: course.id, slug: course.slug, title: course.title })),
        people: result.data.people.map((person) => ({ employeeId: person.employeeId, name: person.name })),
      })
    })
    return () => {
      cancelled = true
    }
  }, [needsLoad, loaded])

  const courses = givenCourses ?? loaded?.courses ?? null
  const people = useMemo<AssignablePerson[] | null>(
    () => (fixedEmployee ? [fixedEmployee] : (givenPeople ?? loaded?.people ?? null)),
    [fixedEmployee, givenPeople, loaded],
  )
  const names = useMemo(() => new Map((people ?? []).map((person) => [person.employeeId, person.name])), [people])

  const reset = (): void => {
    setCourseId('')
    setSelected(new Set())
    setDueOn('')
    setNote('')
    setFormError(null)
  }

  const close = (): void => {
    if (pending) return
    reset()
    onClose()
  }

  const toggle = (employeeId: string, checked: boolean): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(employeeId)
      else next.delete(employeeId)
      return next
    })
  }

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const employeeIds = fixedEmployee ? [fixedEmployee.employeeId] : [...selected]
    if (!courseId) {
      setFormError('Choose a course.')
      return
    }
    if (employeeIds.length === 0) {
      setFormError('Choose at least one person.')
      return
    }
    setFormError(null)
    startTransition(async () => {
      const result = await runTrainingAction(
        () => assignCourse({ employeeIds, courseId, dueOn: dueOn || null, note: note.trim() || undefined }),
        'The training could not be assigned. Try again.',
      )
      if (result.error || !result.data) {
        setFormError(result.error ?? 'The training could not be assigned. Try again.')
        return
      }
      const message = describeResult(result.data, names)
      if (result.data.created > 0) {
        toast.success(message)
        onAssigned?.()
      } else {
        toast.error(message)
      }
      reset()
      onClose()
    })
  }

  const allSelected = people !== null && people.length > 0 && people.every((person) => selected.has(person.employeeId))
  const ready = courses !== null && people !== null
  // Nothing to submit: no course to choose, or (choosing people) nobody to choose.
  const nothingToAssign = ready && (courses.length === 0 || people.length === 0)

  return (
    <Modal
      open={open}
      onClose={close}
      title="Assign Training"
      description={
        fixedEmployee
          ? `Give ${fixedEmployee.name} a course now, with its own due date if you set one.`
          : 'Give people a course now, with its own due date if you set one.'
      }
      width="lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={pending} disabled={!ready || nothingToAssign}>
            Assign Training
          </Button>
        </>
      }
    >
      {loadError ? (
        <Alert tone="danger" title="Could not load the courses">
          {loadError}
        </Alert>
      ) : !ready ? (
        <PageLoading inline />
      ) : (
        <form id={FORM_ID} onSubmit={submit} className="space-y-4">
          <FormError error={formError} />
          {courses.length === 0 ? (
            <Alert tone="info">
              {fixedEmployee ? 'Every live course is already open for this person.' : 'There are no live courses to assign yet.'}
            </Alert>
          ) : (
            <Select
              label="Course"
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
              placeholder="Choose a course"
              options={courses.map((course) => ({ value: course.id, label: course.title }))}
            />
          )}
          {fixedEmployee ? null : (
            <Fieldset legend="People" hint="Anyone who already has this course open is skipped.">
              {people.length === 0 ? (
                <p className="text-sm text-text-muted">There are no active staff.</p>
              ) : (
                <div className="space-y-1">
                  <Checkbox
                    label="Select All"
                    checked={allSelected}
                    indeterminate={!allSelected && selected.size > 0}
                    onChange={(checked) => setSelected(checked ? new Set(people.map((person) => person.employeeId)) : new Set())}
                  />
                  <div className="grid gap-1 sm:grid-cols-2">
                    {people.map((person) => (
                      <Checkbox
                        key={person.employeeId}
                        label={person.name}
                        checked={selected.has(person.employeeId)}
                        onChange={(checked) => toggle(person.employeeId, checked)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </Fieldset>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              type="date"
              label="Due Date"
              hint="Leave empty to use the course's own rule."
              value={dueOn}
              onChange={(event) => setDueOn(event.target.value)}
            />
          </div>
          <Textarea
            label="Note"
            hint="Optional. Saved in the training log."
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
        </form>
      )}
    </Modal>
  )
}
