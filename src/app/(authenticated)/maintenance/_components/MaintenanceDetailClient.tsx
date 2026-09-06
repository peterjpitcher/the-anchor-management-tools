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
  estimatedCost: string
  actualCost: string
  contractorName: string
  contractorContact: string
}

type FieldErrors = Partial<
  Record<'title' | 'areaId' | 'estimatedCost' | 'actualCost' | 'targetDate', string>
>

type UpdatePayload = Parameters<typeof updateMaintenanceItem>[0]

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
 */
export function MaintenanceDetailClient({
  item,
  areas,
  todayIsoDate,
}: MaintenanceDetailClientProps): React.JSX.Element {
  // The record as we last saw it saved. expectedUpdatedAt always comes from here.
  const [baseline, setBaseline] = useState<MaintenanceItem>(item)
  const [form, setForm] = useState<FormState>(() => formFromItem(item))
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [reloaded, setReloaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reloading, setReloading] = useState(false)

  const titleRef = useRef<HTMLInputElement>(null)
  const areaRef = useRef<HTMLSelectElement>(null)
  const estimateRef = useRef<HTMLInputElement>(null)
  const actualRef = useRef<HTMLInputElement>(null)
  const targetRef = useRef<HTMLInputElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)

  const savedForm = useMemo(() => formFromItem(baseline), [baseline])
  const dirty = useMemo(
    () => (Object.keys(savedForm) as Array<keyof FormState>).some(key => form[key] !== savedForm[key]),
    [form, savedForm]
  )

  const overdue = isMaintenanceItemOverdue(
    { status: form.status, targetDate: form.targetDate || null },
    todayIsoDate
  )

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(current => ({ ...current, [key]: value }))
  }, [])

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
    return errors
  }

  function focusFirstError(errors: FieldErrors): void {
    if (errors.title) return titleRef.current?.focus()
    if (errors.areaId) return areaRef.current?.focus()
    if (errors.targetDate) return targetRef.current?.focus()
    if (errors.estimatedCost) return estimateRef.current?.focus()
    if (errors.actualCost) return actualRef.current?.focus()
  }

  function buildPatch(): UpdatePayload {
    // Only what actually changed is sent, so an untouched field is never rewritten
    // and never appears in the history trail.
    //
    // completedOn is deliberately absent. The service derives it from the status
    // change: today in London when an item is marked done, cleared when it is
    // reopened. Sending it from here would put two rules in play.
    const patch: UpdatePayload = {
      id: baseline.id,
      expectedUpdatedAt: baseline.updatedAt,
    }

    if (form.kind !== savedForm.kind) patch.kind = form.kind
    if (form.title !== savedForm.title) patch.title = form.title.trim()
    if (form.description !== savedForm.description) {
      patch.description = form.description.trim() ? form.description.trim() : null
    }
    if (form.areaId !== savedForm.areaId) patch.areaId = form.areaId
    if (form.status !== savedForm.status) patch.status = form.status
    if (form.priority !== savedForm.priority) patch.priority = form.priority
    if (form.responsibility !== savedForm.responsibility) {
      patch.responsibility = form.responsibility
    }
    if (form.reportedOn !== savedForm.reportedOn) patch.reportedOn = form.reportedOn
    if (form.targetDate !== savedForm.targetDate) {
      patch.targetDate = form.targetDate ? form.targetDate : null
    }
    if (form.estimatedCost !== savedForm.estimatedCost) {
      patch.estimatedCost = moneyOrNull(form.estimatedCost)
    }
    if (form.actualCost !== savedForm.actualCost) {
      patch.actualCost = moneyOrNull(form.actualCost)
    }
    if (form.contractorName !== savedForm.contractorName) {
      patch.contractorName = form.contractorName.trim() ? form.contractorName.trim() : null
    }
    if (form.contractorContact !== savedForm.contractorContact) {
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
    setReloaded(false)
    const errors = validate()
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors)
      return
    }

    setSaving(true)
    const result = await updateMaintenanceItem(buildPatch())
    setSaving(false)

    if (result.success && result.data) {
      setStale(false)
      setBaseline(result.data)
      setForm(formFromItem(result.data))
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
      setFieldErrors({ areaId: result.error ?? 'That area is no longer available. Pick another one.' })
      areaRef.current?.focus()
      return
    }

    setSaveError(result.error ?? 'Could not save your changes. Please try again.')
    window.setTimeout(() => alertRef.current?.focus(), 0)
  }

  /**
   * Fetch the newer version and move the baseline on to it, keeping every value
   * the user typed. They can then check their changes and save again.
   */
  const handleReload = useCallback(async () => {
    setReloading(true)
    const result = await getMaintenanceItem(baseline.id)
    setReloading(false)

    if (!result.success || !result.data) {
      setSaveError(result.error ?? 'Could not load the newer version. Please reload the page.')
      return
    }

    setBaseline(result.data)
    setStale(false)
    setReloaded(true)
  }, [baseline.id])

  const handleCancel = useCallback(() => {
    setForm(formFromItem(baseline))
    setFieldErrors({})
    setSaveError(null)
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
                  Set automatically when the status becomes done
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

      {(stale || saveError || reloaded) && (
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
            </Alert>
          )}
          {reloaded && !stale && (
            <Alert tone="info" title="Loaded the newer version">
              Your changes are still in the form. Check them against the details above, then save
              again.
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
                {areas.map(area => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </Select>

              <Select
                label="Status"
                value={form.status}
                onChange={event => set('status', event.target.value as MaintenanceStatus)}
                hint="Marking this done stamps today's date automatically"
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
