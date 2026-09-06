'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Card, CardBody, Input, Select, Textarea, toast } from '@/ds'
import { getMaintenanceItem, updateMaintenanceItem } from '@/app/actions/maintenance'
import {
  MAINTENANCE_KINDS,
  MAINTENANCE_KIND_LABELS,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_PRIORITY_LABELS,
  MAINTENANCE_RESPONSIBILITIES,
  MAINTENANCE_RESPONSIBILITY_LABELS,
  MAINTENANCE_STATUSES,
  MAINTENANCE_STATUS_LABELS,
  isMaintenanceItemOverdue,
  type MaintenanceArea,
  type MaintenanceItem,
  type MaintenanceKind,
  type MaintenancePriority,
  type MaintenanceResponsibility,
  type MaintenanceStatus,
} from '@/types/maintenance'
import { MaintenancePhotos } from './MaintenancePhotos'
import { MaintenanceTimeline } from './MaintenanceTimeline'
import {
  MAINTENANCE_PRIORITY_TONES,
  MAINTENANCE_RESPONSIBILITY_TONES,
  MAINTENANCE_STATUS_TONES,
  formatMaintenanceDate,
  formatOptionalPounds,
  maintenanceActorLabel,
} from './maintenanceDisplay'

export interface MaintenanceDetailClientProps {
  item: MaintenanceItem
  areas: MaintenanceArea[]
  /** Today in London, resolved on the server so overdue never depends on the device clock. */
  todayIsoDate: string
}

interface FormState {
  kind: MaintenanceKind
  title: string
  description: string
  areaId: string
  status: MaintenanceStatus
  priority: MaintenancePriority
  responsibility: MaintenanceResponsibility
  reportedOn: string
  targetDate: string
  completedOn: string
  estimatedCost: string
  actualCost: string
  contractorName: string
  contractorContact: string
}

type FieldErrors = Partial<
  Record<'title' | 'areaId' | 'estimatedCost' | 'actualCost' | 'targetDate' | 'completedOn', string>
>

type UpdatePayload = Parameters<typeof updateMaintenanceItem>[0]

/** Shown when a saved write never came back at all, rather than came back refused. */
const SAVE_UNREACHABLE =
  'Could not save. Check your connection and try again. Nothing you typed has been lost.'

function formFromItem(item: MaintenanceItem): FormState {
  return {
    kind: item.kind,
    title: item.title,
    description: item.description ?? '',
    areaId: item.areaId,
    status: item.status,
    priority: item.priority,
    responsibility: item.responsibility,
    reportedOn: item.reportedOn,
    targetDate: item.targetDate ?? '',
    completedOn: item.completedOn ?? '',
    estimatedCost: item.estimatedCost === null ? '' : String(item.estimatedCost),
    actualCost: item.actualCost === null ? '' : String(item.actualCost),
    contractorName: item.contractorName ?? '',
    contractorContact: item.contractorContact ?? '',
  }
}

function moneyOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  return Number(trimmed)
}

function isValidMoney(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0
}

/**
 * The item, editable with an explicit save and cancel. Nothing here saves on its
 * own: an ambient auto-save on a shared record is how two people quietly overwrite
 * each other.
 *
 * Concurrency is optimistic on updated_at. The value the form was built from goes
 * back as expectedUpdatedAt, and a write against a moved record is refused rather
 * than applied. When that happens the typing stays exactly where it is and the
 * user is offered the newer version to reapply on to.
 *
 * Only fields the user actually edited are ever written. A diff against the
 * baseline is not enough on its own: after loading a newer version, a field
 * somebody else changed differs from what is on screen, and sending that diff
 * would quietly put their change back the way it was.
 */
export function MaintenanceDetailClient({
  item,
  areas,
  todayIsoDate,
}: MaintenanceDetailClientProps): React.JSX.Element {
  // The record as we last saw it saved. expectedUpdatedAt always comes from here.
  const [baseline, setBaseline] = useState<MaintenanceItem>(item)
  const [form, setForm] = useState<FormState>(() => formFromItem(item))
  // The fields this person has edited since the form was last in step with the
  // server. Nothing outside this set is ever written.
  const [touched, setTouched] = useState<ReadonlySet<keyof FormState>>(() => new Set())
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  // Kept apart from saveError: the write is still stale, so that warning has to
  // stay up while this explains why fetching the newer version did not work.
  const [reloadError, setReloadError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [reloaded, setReloaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reloading, setReloading] = useState(false)

  const titleRef = useRef<HTMLInputElement>(null)
  const areaRef = useRef<HTMLSelectElement>(null)
  const estimateRef = useRef<HTMLInputElement>(null)
  const actualRef = useRef<HTMLInputElement>(null)
  const targetRef = useRef<HTMLInputElement>(null)
  const completedRef = useRef<HTMLInputElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)

  const savedForm = useMemo(() => formFromItem(baseline), [baseline])
  const changedKeys = useMemo(
    () =>
      (Object.keys(savedForm) as Array<keyof FormState>).filter(
        key => touched.has(key) && form[key] !== savedForm[key]
      ),
    [form, savedForm, touched]
  )
  const dirty = changedKeys.length > 0

  const overdue = isMaintenanceItemOverdue(
    { status: form.status, targetDate: form.targetDate || null },
    todayIsoDate
  )

  const markTouched = useCallback((key: keyof FormState) => {
    setTouched(current => {
      if (current.has(key)) return current
      const next = new Set(current)
      next.add(key)
      return next
    })
  }, [])

  const set = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      markTouched(key)
      setForm(current => ({ ...current, [key]: value }))
    },
    [markTouched]
  )

  /**
   * Status carries the completion date with it. Moving to done shows the date the
   * service would stamp, so the screen and the saved record agree; moving off done
   * clears it, because the database refuses a completion date on any other status.
   * Neither counts as the user editing the date, so an untouched date is still
   * derived server side.
   */
  const setStatus = useCallback(
    (status: MaintenanceStatus) => {
      markTouched('status')
      setForm(current => ({
        ...current,
        status,
        completedOn:
          status === 'done'
            ? savedForm.completedOn || current.completedOn || todayIsoDate
            : '',
      }))
      setTouched(current => {
        if (!current.has('completedOn')) return current
        const next = new Set(current)
        next.delete('completedOn')
        return next
      })
    },
    [markTouched, savedForm.completedOn, todayIsoDate]
  )

  function validate(): FieldErrors {
    const errors: FieldErrors = {}
    if (!form.title.trim()) errors.title = 'Give this a short title'
    if (!form.areaId) errors.areaId = 'Choose the area this is in'
    if (!isValidMoney(form.estimatedCost)) {
      errors.estimatedCost = 'Enter the estimate as a number, or leave it blank'
    }
    if (!isValidMoney(form.actualCost)) {
      errors.actualCost = 'Enter the amount as a number, or leave it blank'
    }
    if (form.targetDate && form.targetDate < form.reportedOn) {
      errors.targetDate = 'The target date cannot be before the date this was reported'
    }
    // Only checked when one of the three inputs that decide the completion date is
    // actually in play. A row that already breaks the rule must not block an edit
    // to something else entirely.
    const completionInPlay =
      touched.has('status') || touched.has('completedOn') || touched.has('reportedOn')
    if (form.status === 'done' && completionInPlay) {
      if (!form.completedOn) {
        errors.completedOn = 'Enter the date this was completed'
      } else if (form.completedOn > todayIsoDate) {
        errors.completedOn = 'The completion date cannot be in the future'
      } else if (form.completedOn < form.reportedOn) {
        errors.completedOn = 'The completion date cannot be before the date this was reported'
      }
    }
    return errors
  }

  function focusFirstError(errors: FieldErrors): void {
    if (errors.title) return titleRef.current?.focus()
    if (errors.areaId) return areaRef.current?.focus()
    if (errors.targetDate) return targetRef.current?.focus()
    if (errors.completedOn) return completedRef.current?.focus()
    if (errors.estimatedCost) return estimateRef.current?.focus()
    if (errors.actualCost) return actualRef.current?.focus()
  }

  function buildPatch(): UpdatePayload {
    // Only fields this person edited, and only where the value actually differs.
    // A field they never touched cannot appear here, so reloading a newer version
    // and saving can never push somebody else's change back.
    //
    // completedOn is sent only when the date itself was edited. Left alone, the
    // service derives it from the status change: today in London when an item is
    // marked done, cleared when it is reopened.
    const patch: UpdatePayload = {
      id: baseline.id,
      expectedUpdatedAt: baseline.updatedAt,
    }

    const edited = (key: keyof FormState): boolean => changedKeys.includes(key)

    if (edited('kind')) patch.kind = form.kind
    if (edited('title')) patch.title = form.title.trim()
    if (edited('description')) {
      patch.description = form.description.trim() ? form.description.trim() : null
    }
    if (edited('areaId')) patch.areaId = form.areaId
    if (edited('status')) patch.status = form.status
    if (edited('priority')) patch.priority = form.priority
    if (edited('responsibility')) {
      patch.responsibility = form.responsibility
    }
    if (edited('reportedOn')) patch.reportedOn = form.reportedOn
    if (edited('targetDate')) {
      patch.targetDate = form.targetDate ? form.targetDate : null
    }
    if (edited('completedOn')) {
      patch.completedOn = form.completedOn ? form.completedOn : null
    }
    if (edited('estimatedCost')) {
      patch.estimatedCost = moneyOrNull(form.estimatedCost)
    }
    if (edited('actualCost')) {
      patch.actualCost = moneyOrNull(form.actualCost)
    }
    if (edited('contractorName')) {
      patch.contractorName = form.contractorName.trim() ? form.contractorName.trim() : null
    }
    if (edited('contractorContact')) {
      patch.contractorContact = form.contractorContact.trim()
        ? form.contractorContact.trim()
        : null
    }

    return patch
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (saving || !dirty) return

    setSaveError(null)
    setReloadError(null)
    setReloaded(false)
    const errors = validate()
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors)
      return
    }

    setSaving(true)
    try {
      const result = await updateMaintenanceItem(buildPatch())

      if (result.success && result.data) {
        setStale(false)
        setBaseline(result.data)
        setForm(formFromItem(result.data))
        setTouched(new Set())
        toast.success('Changes saved')
        return
      }

      // Nothing typed is discarded on any failure path.
      if (result.code === 'stale_write') {
        setStale(true)
        window.setTimeout(() => alertRef.current?.focus(), 0)
        return
      }

      if (result.code === 'area_inactive') {
        setFieldErrors({
          areaId: result.error ?? 'That area is no longer available. Pick another one.',
        })
        areaRef.current?.focus()
        return
      }

      setSaveError(result.error ?? 'Could not save your changes. Please try again.')
      window.setTimeout(() => alertRef.current?.focus(), 0)
    } catch {
      // The write never got an answer: a dropped connection, an expired session or
      // a gateway error. Without this the button would spin for ever and the guard
      // above would block the retry.
      setSaveError(SAVE_UNREACHABLE)
      window.setTimeout(() => alertRef.current?.focus(), 0)
    } finally {
      setSaving(false)
    }
  }

  /**
   * Fetch the newer version and move the baseline on to it. Fields this person
   * edited keep what they typed; everything else takes the newer value, so what is
   * on screen is what will be saved.
   */
  const handleReload = useCallback(async () => {
    setReloading(true)
    setReloadError(null)
    try {
      const result = await getMaintenanceItem(baseline.id)

      if (!result.success || !result.data) {
        setReloadError(result.error ?? 'Could not load the newer version. Please reload the page.')
        return
      }

      const fresh = result.data
      setBaseline(fresh)
      setForm(current => {
        const merged = formFromItem(fresh)
        for (const key of touched) {
          Object.assign(merged, { [key]: current[key] })
        }
        return merged
      })
      setStale(false)
      setReloaded(true)
    } catch {
      setReloadError(
        'Could not load the newer version. Check your connection and try again. Nothing you typed has been lost.'
      )
    } finally {
      setReloading(false)
    }
  }, [baseline.id, touched])

  const handleCancel = useCallback(() => {
    setForm(formFromItem(baseline))
    setTouched(new Set())
    setFieldErrors({})
    setSaveError(null)
    setReloadError(null)
    setStale(false)
    setReloaded(false)
  }, [baseline])

  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs text-text-muted">{baseline.reference}</p>
              <h1 className="mt-0.5 text-lg font-semibold text-text">{baseline.title}</h1>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={MAINTENANCE_STATUS_TONES[baseline.status]}>
                {MAINTENANCE_STATUS_LABELS[baseline.status]}
              </Badge>
              <Badge tone={MAINTENANCE_PRIORITY_TONES[baseline.priority]}>
                {MAINTENANCE_PRIORITY_LABELS[baseline.priority]}
              </Badge>
              <Badge tone={MAINTENANCE_RESPONSIBILITY_TONES[baseline.responsibility]}>
                {MAINTENANCE_RESPONSIBILITY_LABELS[baseline.responsibility]}
              </Badge>
              <Badge tone="neutral">{MAINTENANCE_KIND_LABELS[baseline.kind]}</Badge>
              {overdue && <Badge tone="danger">Overdue</Badge>}
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-text-muted">Reported on</dt>
              <dd className="text-text">{formatMaintenanceDate(baseline.reportedOn)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Completed on</dt>
              <dd className="text-text">
                {formatMaintenanceDate(baseline.completedOn)}
                <span className="block text-xs text-text-muted">
                  Defaults to today when the status becomes done, and can be changed for work
                  written up late.
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">Estimated cost</dt>
              <dd className="text-text">{formatOptionalPounds(baseline.estimatedCost)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Actual cost</dt>
              <dd className="text-text">
                {formatOptionalPounds(baseline.actualCost)}
                <span className="block text-xs text-text-muted">
                  A recorded amount, not a reconciled payment
                </span>
              </dd>
            </div>
          </dl>

          <p className="mt-3 text-xs text-text-muted">
            Logged by {maintenanceActorLabel(baseline.createdByEmail)}. All amounts are in pounds
            including VAT.
          </p>
        </CardBody>
      </Card>

      {(stale || saveError || reloadError || reloaded) && (
        <div ref={alertRef} tabIndex={-1}>
          {stale && (
            <Alert tone="warning" title="Someone else changed this while you were editing">
              <p>
                Nothing you typed has been lost and nothing has been overwritten. Load the newer
                version, check your changes still make sense, then save again.
              </p>
              <p className="mt-2">
                <Button size="sm" onClick={() => void handleReload()} loading={reloading}>
                  Load the newer version
                </Button>
              </p>
              {reloadError && (
                <p className="mt-2 text-danger" role="alert">
                  {reloadError}
                </p>
              )}
            </Alert>
          )}
          {reloadError && !stale && (
            <Alert tone="danger" title="Could not load the newer version">
              {reloadError}
            </Alert>
          )}
          {reloaded && !stale && (
            <Alert tone="info" title="Loaded the newer version">
              Your own changes are still in the form. Anything you did not change now shows the
              newer value. Check it over, then save again.
            </Alert>
          )}
          {saveError && !stale && (
            <Alert tone="danger" title="Could not save your changes">
              {saveError}
            </Alert>
          )}
        </div>
      )}

      <form onSubmit={handleSave} noValidate>
        <Card>
          <CardBody>
            <h2 className="text-sm font-semibold text-text">Details</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Input
                  ref={titleRef}
                  label="Title"
                  value={form.title}
                  onChange={event => set('title', event.target.value)}
                  error={fieldErrors.title}
                  maxLength={200}
                  required
                />
              </div>

              <Select
                label="Type"
                value={form.kind}
                onChange={event => set('kind', event.target.value as MaintenanceKind)}
              >
                {MAINTENANCE_KINDS.map(kind => (
                  <option key={kind} value={kind}>
                    {MAINTENANCE_KIND_LABELS[kind]}
                  </option>
                ))}
              </Select>

              <Select
                ref={areaRef}
                label="Area"
                value={form.areaId}
                onChange={event => set('areaId', event.target.value)}
                error={fieldErrors.areaId}
              >
                <option value="">Choose an area</option>
                {/*
                  Switched-off areas are listed so an item already in one still reads
                  correctly. They cannot be picked for anything else: the database
                  refuses a move on to an inactive area.
                */}
                {areas.map(area => (
                  <option
                    key={area.id}
                    value={area.id}
                    disabled={!area.active && area.id !== savedForm.areaId}
                  >
                    {area.active ? area.name : `${area.name} (off)`}
                  </option>
                ))}
              </Select>

              <Select
                label="Status"
                value={form.status}
                onChange={event => setStatus(event.target.value as MaintenanceStatus)}
                hint="Marking this done sets the completion date to today, which you can change"
              >
                {MAINTENANCE_STATUSES.map(status => (
                  <option key={status} value={status}>
                    {MAINTENANCE_STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>

              <Select
                label="Priority"
                value={form.priority}
                onChange={event => set('priority', event.target.value as MaintenancePriority)}
              >
                {MAINTENANCE_PRIORITIES.map(priority => (
                  <option key={priority} value={priority}>
                    {MAINTENANCE_PRIORITY_LABELS[priority]}
                  </option>
                ))}
              </Select>

              <Select
                label="Responsibility"
                value={form.responsibility}
                onChange={event =>
                  set('responsibility', event.target.value as MaintenanceResponsibility)
                }
              >
                {MAINTENANCE_RESPONSIBILITIES.map(value => (
                  <option key={value} value={value}>
                    {MAINTENANCE_RESPONSIBILITY_LABELS[value]}
                  </option>
                ))}
              </Select>

              <Input
                label="Reported on"
                type="date"
                value={form.reportedOn}
                onChange={event => set('reportedOn', event.target.value)}
              />

              <Input
                ref={targetRef}
                label="Target date"
                type="date"
                value={form.targetDate}
                onChange={event => set('targetDate', event.target.value)}
                error={fieldErrors.targetDate}
                hint="Leave blank if there is no date to work to"
              />

              {/*
                Only meaningful on a completed item, and the database refuses a
                completion date on any other status. Work finished weeks ago and
                logged today is dated truthfully by editing this.
              */}
              {form.status === 'done' && (
                <Input
                  ref={completedRef}
                  label="Completed on"
                  type="date"
                  value={form.completedOn}
                  max={todayIsoDate}
                  onChange={event => set('completedOn', event.target.value)}
                  error={fieldErrors.completedOn}
                  hint="Defaults to today. Change it if the work was finished earlier."
                />
              )}

              <Input
                ref={estimateRef}
                label="Estimated cost"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={form.estimatedCost}
                onChange={event => set('estimatedCost', event.target.value)}
                error={fieldErrors.estimatedCost}
                hint="Pounds including VAT. Blank means not costed, which is not nil."
              />

              <Input
                ref={actualRef}
                label="Actual cost"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={form.actualCost}
                onChange={event => set('actualCost', event.target.value)}
                error={fieldErrors.actualCost}
                hint="What it came to. A recorded amount, not a reconciled payment."
              />

              <Input
                label="Contractor"
                value={form.contractorName}
                onChange={event => set('contractorName', event.target.value)}
                maxLength={200}
              />

              <Input
                label="Contractor contact"
                value={form.contractorContact}
                onChange={event => set('contractorContact', event.target.value)}
                maxLength={200}
              />

              <div className="sm:col-span-2">
                <Textarea
                  label="Description"
                  value={form.description}
                  onChange={event => set('description', event.target.value)}
                  rows={4}
                  maxLength={5000}
                />
              </div>
            </div>

            <p className="sr-only" role="status" aria-live="polite">
              {saving ? 'Saving your changes' : dirty ? 'You have unsaved changes' : ''}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary" loading={saving} disabled={saving || !dirty}>
                Save changes
              </Button>
              <Button type="button" variant="secondary" onClick={handleCancel} disabled={!dirty}>
                Cancel
              </Button>
              {dirty && <span className="text-xs text-text-muted">Unsaved changes</span>}
            </div>
          </CardBody>
        </Card>
      </form>

      <MaintenancePhotos itemId={baseline.id} itemTitle={baseline.title} />

      <MaintenanceTimeline itemId={baseline.id} />
    </div>
  )
}

export default MaintenanceDetailClient
