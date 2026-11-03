'use client'

import { useEffect, useState, useTransition } from 'react'
import { Alert, Button, Checkbox, Fieldset, FileButton, Input, Modal, PageLoading, Select, Textarea, toast } from '@/ds'
import { recordExternalQualification, recordPracticalSignoff, recordTrainedInPerson } from '@/app/actions/training'
import { listTrainingCourses } from '@/app/actions/training-courses'
import { TRAINING_SUPERVISED_ONLY_BADGE } from '@/lib/training/labels'
import type { CourseRef, EmployeeAssignmentItem } from '@/lib/training/types'
import { EXTERNAL_CERTIFICATE_MAX_BYTES } from '@/lib/training/upload-limits'
import { FormError, useFormError } from '../FormError'
import { runTrainingAction } from '../run-action'
import { practicalTasksOf } from './item-actions'

interface SignoffDialogProps {
  item: EmployeeAssignmentItem | null
  employeeId: string
  employeeName: string
  today: string
  /** True when the person is under 18 (sign-offs on some tasks are supervised only). */
  under18: boolean | null
  onClose: () => void
  /** Called with the in-person link once the sign-off is recorded. */
  onRecorded: (inPersonUrl: string) => void
}

const SIGNOFF_FORM_ID = 'training-signoff-form'

/**
 * Record a practical sign-off: the tasks you watched and the day. Every task must be watched, so
 * Record stays off until each one is ticked (the server refuses a partial list too). You sign as
 * the business now; the person then confirms in person on their own device.
 */
export function SignoffDialog({ item, employeeId, employeeName, today, under18, onClose, onRecorded }: SignoffDialogProps): React.JSX.Element {
  const [pending, startTransition] = useTransition()
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [observedOn, setObservedOn] = useState(today)
  const [note, setNote] = useState('')
  const [error, setError] = useFormError()
  const tasks = item ? practicalTasksOf(item) : []
  const tickedCount = tasks.filter((task) => ticked.has(task.key)).length
  const allTicked = tasks.length > 0 && tickedCount === tasks.length

  useEffect(() => {
    if (!item) return
    setTicked(new Set())
    setObservedOn(today)
    setNote('')
    setError(null)
  }, [item, today])

  const close = (): void => {
    if (!pending) onClose()
  }

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!item) return
    if (!allTicked) {
      setError('Tick every task. A sign-off needs you to have watched them do all of them.')
      return
    }
    if (!observedOn || observedOn > today) {
      setError('Choose the day you watched them, today or earlier.')
      return
    }
    setError(null)
    const input = {
      employeeId,
      courseId: item.course.id,
      tasks: tasks.map((task) => task.key),
      observedOn,
      note: note.trim() || undefined,
    }
    startTransition(async () => {
      const result = await runTrainingAction(() => recordPracticalSignoff(input), 'The sign-off could not be recorded. Try again.')
      if (result.error || !result.data) {
        setError(result.error ?? 'The sign-off could not be recorded. Try again.')
        return
      }
      toast.success('Sign-off recorded. Now ask them to confirm it.')
      onRecorded(result.data.inPersonUrl)
    })
  }

  return (
    <Modal
      open={item !== null}
      onClose={close}
      title="Record Sign-off"
      description={item ? `${item.course.title}: tick each task as you watch ${employeeName} do it. You sign as the business; they confirm in person next.` : undefined}
      width="lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={SIGNOFF_FORM_ID} variant="primary" loading={pending} disabled={!allTicked}>
            Record Sign-off
          </Button>
        </>
      }
    >
      <form id={SIGNOFF_FORM_ID} onSubmit={submit} className="space-y-4">
        <FormError error={error} />
        {under18 ? (
          <Alert tone="warning" title={TRAINING_SUPERVISED_ONLY_BADGE.label}>
            They are under 18, so this sign-off may record them as supervised only: never cleared to do these tasks alone.
          </Alert>
        ) : null}
        {tasks.length === 0 ? (
          <Alert tone="danger" title="The task list could not be loaded">
            Open the course to check it has a published version with tasks, then try again.
          </Alert>
        ) : (
          <>
            <Alert tone="info" title="Every task must be watched">
              You can only sign this off once you have watched them do all {tasks.length} tasks. If they have not done one yet,
              sign it off another day.
            </Alert>
            <Fieldset legend="Tasks Watched" hint={`${tickedCount} of ${tasks.length} ticked`} required>
              <div className="space-y-1">
                {tasks.map((task) => (
                  <Checkbox
                    key={task.key}
                    label={task.text}
                    checked={ticked.has(task.key)}
                    onChange={(checked) =>
                      setTicked((current) => {
                        const next = new Set(current)
                        if (checked) next.add(task.key)
                        else next.delete(task.key)
                        return next
                      })
                    }
                  />
                ))}
              </div>
            </Fieldset>
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input type="date" label="Watched On" value={observedOn} max={today} onChange={(event) => setObservedOn(event.target.value)} />
        </div>
        <Textarea label="Note" hint="Optional. Saved in the training log." value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
      </form>
    </Modal>
  )
}

const CERTIFICATE_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'
const CERTIFICATE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png'])

interface ExternalDialogProps {
  open: boolean
  employeeId: string
  employeeName: string
  /** The course being recorded (an open external item). Left out: choose from the live external qualifications. */
  course: CourseRef | null
  today: string
  onClose: () => void
  onDone: () => void
}

const EXTERNAL_FORM_ID = 'training-external-form'

/** Record an external qualification with its certificate file. Recording it completes it. */
export function ExternalDialog({ open, employeeId, employeeName, course, today, onClose, onDone }: ExternalDialogProps): React.JSX.Element {
  const [pending, startTransition] = useTransition()
  const [choices, setChoices] = useState<CourseRef[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [courseId, setCourseId] = useState('')
  const [issuer, setIssuer] = useState('')
  const [reference, setReference] = useState('')
  const [issuedOn, setIssuedOn] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useFormError()

  useEffect(() => {
    if (!open) return
    setCourseId(course?.id ?? '')
    setIssuer('')
    setReference('')
    setIssuedOn('')
    setExpiresOn('')
    setFile(null)
    setError(null)
  }, [open, course])

  useEffect(() => {
    if (!open || course || choices) return
    let cancelled = false
    void runTrainingAction(() => listTrainingCourses(), 'The qualifications could not be loaded.').then((result) => {
      if (cancelled) return
      if (result.error || !result.data) {
        setLoadError(result.error ?? 'The qualifications could not be loaded.')
        return
      }
      setLoadError(null)
      setChoices(
        result.data
          .filter((entry) => entry.kind === 'external' && entry.status === 'live')
          .map((entry) => ({ id: entry.id, slug: entry.slug, title: entry.title })),
      )
    })
    return () => {
      cancelled = true
    }
  }, [open, course, choices])

  const close = (): void => {
    if (!pending) onClose()
  }

  const pick = (files: File[]): void => {
    const chosen = files[0] ?? null
    if (!chosen) return
    if (!CERTIFICATE_TYPES.has(chosen.type)) {
      setError('The certificate must be a PDF, JPG or PNG file.')
      return
    }
    if (chosen.size > EXTERNAL_CERTIFICATE_MAX_BYTES) {
      setError('The certificate file must be 4 MB or smaller.')
      return
    }
    setError(null)
    setFile(chosen)
  }

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!courseId) return setError('Choose the qualification.')
    if (issuer.trim().length === 0) return setError('Add who issued it.')
    if (!issuedOn || issuedOn > today) return setError('Add the date it was issued, today or earlier.')
    if (expiresOn && expiresOn <= issuedOn) return setError('The expiry date must be after the issue date.')
    if (!file) return setError('Attach the certificate file.')
    setError(null)
    const formData = new FormData()
    formData.set('employeeId', employeeId)
    formData.set('courseId', courseId)
    formData.set('issuer', issuer.trim())
    formData.set('reference', reference.trim())
    formData.set('issuedOn', issuedOn)
    if (expiresOn) formData.set('expiresOn', expiresOn)
    formData.set('file', file)
    startTransition(async () => {
      const result = await runTrainingAction(
        () => recordExternalQualification(formData),
        'The qualification could not be recorded. Try again.',
      )
      if (result.error) {
        setError(result.error)
        return
      }
      toast.success('Qualification recorded.')
      onDone()
    })
  }

  const options = course ? [course] : choices
  return (
    <Modal
      open={open}
      onClose={close}
      title="Record External Qualification"
      description={`A certificate ${employeeName} holds from an outside provider. Recording it marks it done until it expires.`}
      width="lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={EXTERNAL_FORM_ID} variant="primary" loading={pending} disabled={!options || options.length === 0}>
            Record Qualification
          </Button>
        </>
      }
    >
      {loadError ? (
        <Alert tone="danger" title="Could not load the qualifications">
          {loadError}
        </Alert>
      ) : !options ? (
        <PageLoading inline />
      ) : options.length === 0 ? (
        <Alert tone="info">
          There are no external qualification types yet. Add one on Employees, Training, Courses.
        </Alert>
      ) : (
        <form id={EXTERNAL_FORM_ID} onSubmit={submit} className="space-y-4">
          <FormError error={error} />
          <Select
            label="Qualification"
            value={courseId}
            disabled={Boolean(course)}
            placeholder="Choose a qualification"
            onChange={(event) => setCourseId(event.target.value)}
            options={options.map((entry) => ({ value: entry.id, label: entry.title }))}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Issued By" value={issuer} maxLength={120} onChange={(event) => setIssuer(event.target.value)} />
            <Input label="Reference" hint="The certificate number, if it has one." value={reference} maxLength={120} onChange={(event) => setReference(event.target.value)} />
            <Input type="date" label="Issued On" value={issuedOn} max={today} onChange={(event) => setIssuedOn(event.target.value)} />
            <Input
              type="date"
              label="Expires On"
              hint="Leave empty if it does not expire."
              value={expiresOn}
              min={issuedOn || undefined}
              onChange={(event) => setExpiresOn(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <FileButton size="sm" variant="secondary" accept={CERTIFICATE_ACCEPT} onFiles={pick}>
              {file ? 'Choose Another File' : 'Choose File'}
            </FileButton>
            <span className="break-all text-sm text-text-muted">{file ? file.name : 'PDF, JPG or PNG, up to 4 MB'}</span>
          </div>
        </form>
      )}
    </Modal>
  )
}

interface InPersonDialogProps {
  open: boolean
  employeeId: string
  employeeName: string
  today: string
  onClose: () => void
  /** Everything ticked was recorded: close and reload. */
  onDone: () => void
  /** Some were recorded and some were not: reload, and the dialog stays open to say why. */
  onChanged: () => void
}

type InPersonCourse = CourseRef & { kind: 'online' | 'practical' }

const IN_PERSON_FORM_ID = 'training-in-person-form'

/**
 * Record training they have already had in person, before the app (owner decision, 3 November
 * 2026). Tick the courses and the day; each one is recorded as done on that day with your name,
 * and courses that need another first are recorded after it. Nobody signs and nothing is sent.
 */
export function InPersonDialog({ open, employeeId, employeeName, today, onClose, onDone, onChanged }: InPersonDialogProps): React.JSX.Element {
  const [pending, startTransition] = useTransition()
  const [choices, setChoices] = useState<InPersonCourse[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [trainedOn, setTrainedOn] = useState(today)
  const [note, setNote] = useState('')
  const [notRecorded, setNotRecorded] = useState<Array<{ courseId: string; title: string; reason: string }>>([])
  const [error, setError] = useFormError()

  useEffect(() => {
    if (!open) return
    setTicked(new Set())
    setTrainedOn(today)
    setNote('')
    setNotRecorded([])
    setError(null)
  }, [open, today])

  useEffect(() => {
    if (!open || choices) return
    let cancelled = false
    void runTrainingAction(() => listTrainingCourses(), 'The courses could not be loaded.').then((result) => {
      if (cancelled) return
      if (result.error || !result.data) {
        setLoadError(result.error ?? 'The courses could not be loaded.')
        return
      }
      setLoadError(null)
      setChoices(
        result.data.flatMap((entry) =>
          entry.status === 'live' && (entry.kind === 'online' || entry.kind === 'practical')
            ? [{ id: entry.id, slug: entry.slug, title: entry.title, kind: entry.kind }]
            : [],
        ),
      )
    })
    return () => {
      cancelled = true
    }
  }, [open, choices])

  const close = (): void => {
    if (!pending) onClose()
  }

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (ticked.size === 0) return setError('Tick at least one course.')
    if (!trainedOn || trainedOn > today) return setError('Choose the day they were trained, today or earlier.')
    setError(null)
    const input = { employeeId, courseIds: [...ticked], trainedOn, note: note.trim() || undefined }
    startTransition(async () => {
      const result = await runTrainingAction(() => recordTrainedInPerson(input), 'The training could not be recorded. Try again.')
      const recorded = result.data?.recorded ?? []
      const skipped = result.data?.skipped ?? []
      if (recorded.length > 0) {
        toast.success(recorded.length === 1 ? '1 course recorded as trained in person.' : `${recorded.length} courses recorded as trained in person.`)
      }
      if (!result.error && skipped.length === 0) {
        onDone()
        return
      }
      setError(result.error ?? null)
      setNotRecorded(skipped)
      setTicked(new Set([...ticked].filter((courseId) => !recorded.includes(courseId))))
      if (recorded.length > 0) onChanged()
    })
  }

  const tickedCount = choices ? choices.filter((course) => ticked.has(course.id)).length : 0
  return (
    <Modal
      open={open}
      onClose={close}
      title="Record Trained In Person"
      description={`Training ${employeeName} has already had in person. Each course you tick is recorded as done on the day you choose, with your name. They do not sign anything and nothing is sent to them.`}
      width="lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={close} disabled={pending}>
            {notRecorded.length > 0 ? 'Close' : 'Cancel'}
          </Button>
          <Button type="submit" form={IN_PERSON_FORM_ID} variant="primary" loading={pending} disabled={!choices || tickedCount === 0}>
            Record Trained In Person
          </Button>
        </>
      }
    >
      {loadError ? (
        <Alert tone="danger" title="Could not load the courses">
          {loadError}
        </Alert>
      ) : !choices ? (
        <PageLoading inline />
      ) : choices.length === 0 ? (
        <Alert tone="info">There are no live online or practical courses yet. Publish one on Employees, Training, Courses.</Alert>
      ) : (
        <form id={IN_PERSON_FORM_ID} onSubmit={submit} className="space-y-4">
          <FormError error={error} />
          {notRecorded.length > 0 ? (
            <Alert tone="warning" title="Not recorded">
              <ul className="list-disc space-y-1 pl-5">
                {notRecorded.map((entry) => (
                  <li key={entry.courseId}>{entry.reason}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <Alert tone="info" title="Use the last day they were trained">
            Refreshers are worked out from this day. A course that needs another one first (Team training needs Essentials) is
            recorded after it, so you can tick them together.
          </Alert>
          <Fieldset legend="Courses" hint={`${tickedCount} ticked`} required>
            <div className="space-y-1">
              {choices.map((course) => (
                <Checkbox
                  key={course.id}
                  label={`${course.title} (${course.kind})`}
                  checked={ticked.has(course.id)}
                  onChange={(checked) =>
                    setTicked((current) => {
                      const next = new Set(current)
                      if (checked) next.add(course.id)
                      else next.delete(course.id)
                      return next
                    })
                  }
                />
              ))}
            </div>
          </Fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input type="date" label="Trained On" value={trainedOn} max={today} onChange={(event) => setTrainedOn(event.target.value)} />
          </div>
          <Textarea
            label="Note"
            hint="Optional. Who trained them, or where the old record is kept. Saved in the training log."
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
        </form>
      )}
    </Modal>
  )
}
