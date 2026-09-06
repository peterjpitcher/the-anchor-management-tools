'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Card, CardBody, Input, Select, Textarea, toast } from '@/ds'
import { createMaintenanceItem } from '@/app/actions/maintenance'
import {
  MAINTENANCE_KINDS,
  MAINTENANCE_KIND_LABELS,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_PRIORITY_LABELS,
  MAINTENANCE_RESPONSIBILITIES,
  MAINTENANCE_RESPONSIBILITY_LABELS,
  type MaintenanceArea,
  type MaintenanceKind,
  type MaintenancePriority,
  type MaintenanceResponsibility,
} from '@/types/maintenance'

export interface MaintenanceNewClientProps {
  areas: MaintenanceArea[]
}

interface FormState {
  kind: MaintenanceKind
  title: string
  areaId: string
  priority: MaintenancePriority
  description: string
  responsibility: MaintenanceResponsibility
  targetDate: string
  estimatedCost: string
  contractorName: string
  contractorContact: string
}

const EMPTY_FORM: FormState = {
  kind: 'issue',
  title: '',
  areaId: '',
  priority: 'medium',
  description: '',
  responsibility: 'to_confirm',
  targetDate: '',
  estimatedCost: '',
  contractorName: '',
  contractorContact: '',
}

type FieldErrors = Partial<Record<'title' | 'areaId' | 'estimatedCost', string>>

/**
 * Logging something has to take seconds, so only four fields are asked for.
 * Everything else sits behind "Add more detail" and can be filled in later on the
 * item itself. There is deliberately no photo control here: the item is saved
 * first so a failed upload can never lose it.
 */
export function MaintenanceNewClient({ areas }: MaintenanceNewClientProps): React.JSX.Element {
  const router = useRouter()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showMore, setShowMore] = useState(false)

  const titleRef = useRef<HTMLInputElement>(null)
  const areaRef = useRef<HTMLSelectElement>(null)
  const costRef = useRef<HTMLInputElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm(current => ({ ...current, [key]: value }))
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {}
    if (!form.title.trim()) errors.title = 'Give this a short title'
    if (!form.areaId) errors.areaId = 'Choose the area this is in'
    if (form.estimatedCost.trim()) {
      const parsed = Number(form.estimatedCost)
      if (!Number.isFinite(parsed) || parsed < 0) {
        errors.estimatedCost = 'Enter the estimate as a number, or leave it blank'
      }
    }
    return errors
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (saving) return

    setFormError(null)
    const errors = validate()
    setFieldErrors(errors)

    // An error nobody can find is not an error message. Move focus to the first
    // field that needs attention.
    if (errors.title) {
      titleRef.current?.focus()
      return
    }
    if (errors.areaId) {
      areaRef.current?.focus()
      return
    }
    if (errors.estimatedCost) {
      costRef.current?.focus()
      return
    }

    setSaving(true)
    try {
      const result = await createMaintenanceItem({
        kind: form.kind,
        title: form.title.trim(),
        areaId: form.areaId,
        priority: form.priority,
        responsibility: form.responsibility,
        description: form.description.trim() ? form.description.trim() : null,
        targetDate: form.targetDate ? form.targetDate : null,
        estimatedCost: form.estimatedCost.trim() ? Number(form.estimatedCost) : null,
        contractorName: form.contractorName.trim() ? form.contractorName.trim() : null,
        contractorContact: form.contractorContact.trim() ? form.contractorContact.trim() : null,
      })

      if (!result.success || !result.data) {
        setSaving(false)
        // Nothing the user typed is thrown away on a failure.
        setFormError(result.error ?? 'Could not save that item. Please try again.')
        window.setTimeout(() => errorRef.current?.focus(), 0)
        return
      }

      toast.success(`${result.data.reference} logged`)
      // Stay disabled through the navigation so a second submit cannot create a
      // duplicate while the route is loading. That is why saving is not reset here,
      // and why there is no finally block.
      router.push(`/maintenance/${result.data.id}`)
    } catch {
      // The create never got an answer: a dropped connection or an expired session
      // walking round the pub. Re-enable the button and keep every field, or the
      // whole thing has to be typed again.
      setSaving(false)
      setFormError('Could not save. Check your connection and try again.')
      window.setTimeout(() => errorRef.current?.focus(), 0)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {formError && (
        <div ref={errorRef} tabIndex={-1}>
          <Alert tone="danger" title="Could not save this">
            {formError}
          </Alert>
        </div>
      )}

      <Card>
        <CardBody>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Type"
              value={form.kind}
              onChange={event => set('kind', event.target.value as MaintenanceKind)}
              required
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
              required
            >
              <option value="">Choose an area</option>
              {areas.map(area => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </Select>

            <div className="sm:col-span-2">
              <Input
                ref={titleRef}
                label="Title"
                value={form.title}
                onChange={event => set('title', event.target.value)}
                error={fieldErrors.title}
                hint="What is wrong, or what you want to improve"
                maxLength={200}
                required
              />
            </div>

            <Select
              label="Priority"
              value={form.priority}
              onChange={event => set('priority', event.target.value as MaintenancePriority)}
              required
            >
              {MAINTENANCE_PRIORITIES.map(priority => (
                <option key={priority} value={priority}>
                  {MAINTENANCE_PRIORITY_LABELS[priority]}
                </option>
              ))}
            </Select>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowMore(current => !current)}
            aria-expanded={showMore}
            aria-controls="maintenance-more-detail"
          >
            {showMore ? 'Hide the extra detail' : 'Add more detail'}
          </Button>

          <div
            id="maintenance-more-detail"
            hidden={!showMore}
            className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <div className="sm:col-span-2">
              <Textarea
                label="Description"
                value={form.description}
                onChange={event => set('description', event.target.value)}
                rows={4}
                maxLength={5000}
                hint="Optional. Anything a contractor or a manager would need to know."
              />
            </div>

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
              label="Target date"
              type="date"
              value={form.targetDate}
              onChange={event => set('targetDate', event.target.value)}
              hint="Optional. When it needs to be done by."
            />

            <Input
              ref={costRef}
              label="Estimated cost"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={form.estimatedCost}
              onChange={event => set('estimatedCost', event.target.value)}
              error={fieldErrors.estimatedCost}
              hint="Pounds including VAT. Leave blank if it has not been costed."
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
          </div>
        </CardBody>
      </Card>

      <p className="text-[13px] text-text-muted">
        Save this first, then add photos on the item itself. That way a photo that
        will not upload can never lose what you have written.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" loading={saving} disabled={saving}>
          Save and open
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push('/maintenance')}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export default MaintenanceNewClient
