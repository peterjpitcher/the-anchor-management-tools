'use client'

import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useRouter } from 'next/navigation'
import {
  Button,
  Field,
  Input,
  Textarea,
  Select,
  Switch,
  Modal,
  ModalActions,
} from '@/ds'
import { createTemplate, updateTemplate } from '@/app/actions/checklists-admin'
import type { AdminTemplate } from '@/app/actions/checklists-admin'
import type { Anchor, Freq, ScheduleKind } from '@/lib/checklists/types'
import { DEPARTMENT_OPTIONS } from './format'

const WEEKDAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
]

interface TemplateFormState {
  title: string
  instruction: string
  department: string // '' = inherit from checklist
  sortOrder: string
  scheduleKind: ScheduleKind
  freq: '' | Freq
  freqInterval: string
  anchor: Anchor
  anchorDate: string
  byWeekday: number[]
  atTimes: string // comma-separated HH:MM
  everyHours: string
  firstOffsetMinutes: string
  notBefore: string
  leadMinutes: string
  graceMinutes: string
  intervalDays: string
  toleranceDays: string
  firstDueOn: string
  seasonStart: string
  seasonEnd: string
  requiresValue: boolean
  valueUnit: string
  valueMin: string
  valueMax: string
  isSpotCheckable: boolean
  isActive: boolean
}

function numToStr(v: number | null): string {
  return v == null ? '' : String(v)
}

function initialState(template?: AdminTemplate): TemplateFormState {
  return {
    title: template?.title ?? '',
    instruction: template?.instruction ?? '',
    department: template?.department ?? '',
    sortOrder: numToStr(template?.sortOrder ?? 0),
    scheduleKind: template?.scheduleKind ?? 'calendar',
    freq: template?.freq ?? 'daily',
    freqInterval: numToStr(template?.freqInterval ?? 1),
    anchor: template && template.anchor !== 'anytime' ? template.anchor : 'open',
    anchorDate: template?.anchorDate ?? '',
    byWeekday: template?.byWeekday ?? [],
    atTimes: (template?.atTimes ?? []).map((t) => t.slice(0, 5)).join(', '),
    everyHours: numToStr(template?.everyHours ?? null),
    firstOffsetMinutes: numToStr(template?.firstOffsetMinutes ?? null),
    notBefore: template?.notBefore ? String(template.notBefore).slice(0, 5) : '',
    leadMinutes: numToStr(template?.leadMinutes ?? 0),
    graceMinutes: numToStr(template?.graceMinutes ?? null),
    intervalDays: numToStr(template?.intervalDays ?? null),
    toleranceDays: numToStr(template?.toleranceDays ?? null),
    firstDueOn: template?.firstDueOn ?? '',
    seasonStart: template?.seasonStart ?? '',
    seasonEnd: template?.seasonEnd ?? '',
    requiresValue: template?.requiresValue ?? false,
    valueUnit: template?.valueUnit ?? 'degC',
    valueMin: numToStr(template?.valueMin ?? null),
    valueMax: numToStr(template?.valueMax ?? null),
    isSpotCheckable: template?.isSpotCheckable ?? false,
    isActive: template?.isActive ?? true,
  }
}

function numOrNull(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isNaN(n) ? null : n
}

function parseTimes(s: string): string[] {
  return s
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

interface TemplateModalProps {
  open: boolean
  checklistId: string
  checklistName: string
  template?: AdminTemplate
  onClose: () => void
}

/**
 * The cadence editor. This is the most involved form in the section: only the fields
 * relevant to the chosen schedule kind and anchor are shown. The server action re-validates
 * the whole cadence combination and returns an error string when it is invalid (spec 3.12),
 * which is surfaced inline here.
 */
export function TemplateModal({
  open,
  checklistId,
  checklistName,
  template,
  onClose,
}: TemplateModalProps) {
  const router = useRouter()
  const isEdit = Boolean(template)
  const [form, setForm] = useState<TemplateFormState>(() => initialState(template))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset the form whenever a different template (or a fresh create) is opened.
  const key = template?.id ?? 'new'
  const [lastKey, setLastKey] = useState(key)
  if (open && key !== lastKey) {
    setForm(initialState(template))
    setError(null)
    setLastKey(key)
  }

  const isCalendar = form.scheduleKind === 'calendar'
  const showAnchorDate = useMemo(() => {
    if (!isCalendar || !form.freq) return false
    const interval = numOrNull(form.freqInterval) ?? 1
    return (
      interval > 1 || ['weekly', 'monthly', 'quarterly', 'annual'].includes(form.freq)
    )
  }, [isCalendar, form.freq, form.freqInterval])

  const set = <K extends keyof TemplateFormState>(k: K, v: TemplateFormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }))

  const toggleWeekday = (day: number) => {
    setForm((prev) => ({
      ...prev,
      byWeekday: prev.byWeekday.includes(day)
        ? prev.byWeekday.filter((d) => d !== day)
        : [...prev.byWeekday, day].sort((a, b) => a - b),
    }))
  }

  function buildPayload(): Partial<AdminTemplate> {
    const base: Partial<AdminTemplate> = {
      title: form.title.trim(),
      instruction: form.instruction.trim() || null,
      department: form.department || null,
      sortOrder: numOrNull(form.sortOrder) ?? 0,
      scheduleKind: form.scheduleKind,
      leadMinutes: numOrNull(form.leadMinutes) ?? 0,
      graceMinutes: numOrNull(form.graceMinutes),
      seasonStart: form.seasonStart.trim() || null,
      seasonEnd: form.seasonEnd.trim() || null,
      requiresValue: form.requiresValue,
      valueUnit: form.requiresValue ? form.valueUnit.trim() || null : null,
      valueMin: form.requiresValue ? numOrNull(form.valueMin) : null,
      valueMax: form.requiresValue ? numOrNull(form.valueMax) : null,
      isSpotCheckable: form.isSpotCheckable,
      isActive: form.isActive,
    }

    if (isCalendar) {
      return {
        ...base,
        freq: form.freq || null,
        freqInterval: numOrNull(form.freqInterval) ?? 1,
        anchor: form.anchor,
        anchorDate: form.anchorDate || null,
        byWeekday: form.freq === 'weekly' ? form.byWeekday : null,
        atTimes: form.anchor === 'at_times' ? parseTimes(form.atTimes) : null,
        everyHours: form.anchor === 'every' ? numOrNull(form.everyHours) : null,
        firstOffsetMinutes:
          form.anchor === 'every' ? numOrNull(form.firstOffsetMinutes) : null,
        notBefore: form.anchor === 'every' ? form.notBefore || null : null,
        intervalDays: null,
        toleranceDays: null,
        firstDueOn: null,
      }
    }

    // floating: the action forces anchor='anytime' and nulls calendar-only fields.
    return {
      ...base,
      intervalDays: numOrNull(form.intervalDays),
      toleranceDays: numOrNull(form.toleranceDays),
      firstDueOn: form.firstDueOn || null,
      freq: null,
      anchor: 'anytime',
      byWeekday: null,
      atTimes: null,
      everyHours: null,
    }
  }

  async function handleSubmit() {
    setSaving(true)
    setError(null)
    try {
      const payload = buildPayload()
      const res = isEdit
        ? await updateTemplate(template!.id, payload)
        : await createTemplate(checklistId, payload)
      if (res.error) {
        setError(res.error)
        toast.error(res.error)
        return
      }
      toast.success(isEdit ? 'Task updated' : 'Task created')
      onClose()
      router.refresh()
    } catch {
      const message = 'Something went wrong saving the task'
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="xl"
      title={isEdit ? `Edit task: ${checklistName}` : `New task: ${checklistName}`}
      footer={
        <ModalActions>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleSubmit} loading={saving}>
            {isEdit ? 'Save task' : 'Create task'}
          </Button>
        </ModalActions>
      }
    >
      <div className="space-y-5">
        {error && (
          <p className="rounded-default border-l-4 border-l-danger bg-danger-soft px-3 py-2 text-sm text-danger-fg" role="alert">
            {error}
          </p>
        )}

        {/* Basics */}
        <div className="space-y-4">
          <Field label="Title" required>
            <Input
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="Hoover carpet area"
            />
          </Field>
          <Field label="Instruction" hint="Optional detail shown to staff on the task.">
            <Textarea
              rows={2}
              value={form.instruction}
              onChange={(e) => set('instruction', e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Department" hint="Leave as Inherit to use the checklist's department.">
              <Select
                value={form.department}
                onChange={(e) => set('department', e.target.value)}
              >
                <option value="">Inherit</option>
                {DEPARTMENT_OPTIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sort order">
              <Input
                type="number"
                value={form.sortOrder}
                onChange={(e) => set('sortOrder', e.target.value)}
              />
            </Field>
          </div>
        </div>

        {/* Schedule */}
        <div className="space-y-4 border-t border-border pt-4">
          <Field label="Schedule kind">
            <Select
              value={form.scheduleKind}
              onChange={(e) => set('scheduleKind', e.target.value as ScheduleKind)}
            >
              <option value="calendar">Calendar (fixed cadence)</option>
              <option value="floating">Floating (roughly every N days)</option>
            </Select>
          </Field>

          {isCalendar ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Frequency" required>
                  <Select value={form.freq} onChange={(e) => set('freq', e.target.value as Freq)}>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annual">Annual</option>
                  </Select>
                </Field>
                <Field label="Every N units" hint="1 = every period.">
                  <Input
                    type="number"
                    value={form.freqInterval}
                    onChange={(e) => set('freqInterval', e.target.value)}
                  />
                </Field>
              </div>

              {form.freq === 'weekly' && (
                <Field label="On weekdays" hint="Pick one or more days.">
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS.map((d) => (
                      <Button
                        key={d.value}
                        type="button"
                        size="sm"
                        variant={form.byWeekday.includes(d.value) ? 'primary' : 'secondary'}
                        onClick={() => toggleWeekday(d.value)}
                        aria-pressed={form.byWeekday.includes(d.value)}
                      >
                        {d.label}
                      </Button>
                    ))}
                  </div>
                </Field>
              )}

              {showAnchorDate && (
                <Field
                  label="Anchor date"
                  required
                  hint="The first occurrence. Makes the cadence deterministic."
                >
                  <Input
                    type="date"
                    value={form.anchorDate}
                    onChange={(e) => set('anchorDate', e.target.value)}
                  />
                </Field>
              )}

              <Field label="Anchor" hint="When in the trading day the task is due.">
                <Select value={form.anchor} onChange={(e) => set('anchor', e.target.value as Anchor)}>
                  <option value="open">At open</option>
                  <option value="close">At close</option>
                  <option value="every">Every N hours from open</option>
                  <option value="at_times">At fixed times</option>
                </Select>
              </Field>

              {form.anchor === 'every' && (
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Every N hours" required>
                    <Input
                      type="number"
                      step="0.5"
                      value={form.everyHours}
                      onChange={(e) => set('everyHours', e.target.value)}
                      placeholder="2"
                    />
                  </Field>
                  <Field label="First offset (mins)" hint="Blank = every_hours × 60.">
                    <Input
                      type="number"
                      value={form.firstOffsetMinutes}
                      onChange={(e) => set('firstOffsetMinutes', e.target.value)}
                    />
                  </Field>
                  <Field label="Not before" hint="Optional floor time.">
                    <Input
                      type="time"
                      value={form.notBefore}
                      onChange={(e) => set('notBefore', e.target.value)}
                    />
                  </Field>
                </div>
              )}

              {form.anchor === 'at_times' && (
                <Field label="Times" required hint="Comma-separated, 24h HH:MM (e.g. 14:00, 18:00).">
                  <Input
                    value={form.atTimes}
                    onChange={(e) => set('atTimes', e.target.value)}
                    placeholder="14:00, 18:00"
                  />
                </Field>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Lead minutes" hint="How early the task appears before due.">
                  <Input
                    type="number"
                    value={form.leadMinutes}
                    onChange={(e) => set('leadMinutes', e.target.value)}
                  />
                </Field>
                <Field label="Grace minutes" hint="Blank = the checklist default.">
                  <Input
                    type="number"
                    value={form.graceMinutes}
                    onChange={(e) => set('graceMinutes', e.target.value)}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Season start" hint="MM-DD, optional. Both or neither.">
                  <Input
                    value={form.seasonStart}
                    onChange={(e) => set('seasonStart', e.target.value)}
                    placeholder="10-01"
                  />
                </Field>
                <Field label="Season end" hint="MM-DD, wraps the year end.">
                  <Input
                    value={form.seasonEnd}
                    onChange={(e) => set('seasonEnd', e.target.value)}
                    placeholder="03-31"
                  />
                </Field>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Interval days" required hint="Roughly every N days.">
                  <Input
                    type="number"
                    value={form.intervalDays}
                    onChange={(e) => set('intervalDays', e.target.value)}
                    placeholder="7"
                  />
                </Field>
                <Field label="Tolerance days" required hint="Days of slack before it is missed.">
                  <Input
                    type="number"
                    value={form.toleranceDays}
                    onChange={(e) => set('toleranceDays', e.target.value)}
                    placeholder="2"
                  />
                </Field>
                <Field label="First due on" required hint="The seed anchor.">
                  <Input
                    type="date"
                    value={form.firstDueOn}
                    onChange={(e) => set('firstDueOn', e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Grace minutes" hint="Blank = the checklist default.">
                <Input
                  type="number"
                  value={form.graceMinutes}
                  onChange={(e) => set('graceMinutes', e.target.value)}
                />
              </Field>
            </div>
          )}
        </div>

        {/* Value capture */}
        <div className="space-y-4 border-t border-border pt-4">
          <Switch
            label="Requires a reading (value capture)"
            checked={form.requiresValue}
            onChange={(v) => set('requiresValue', v)}
          />
          {form.requiresValue && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Unit">
                <Select value={form.valueUnit} onChange={(e) => set('valueUnit', e.target.value)}>
                  <option value="degC">Degrees C (degC)</option>
                </Select>
              </Field>
              <Field label="Minimum" hint="At least one bound is required.">
                <Input
                  type="number"
                  step="0.1"
                  inputMode="decimal"
                  value={form.valueMin}
                  onChange={(e) => set('valueMin', e.target.value)}
                />
              </Field>
              <Field label="Maximum">
                <Input
                  type="number"
                  step="0.1"
                  inputMode="decimal"
                  value={form.valueMax}
                  onChange={(e) => set('valueMax', e.target.value)}
                />
              </Field>
            </div>
          )}
        </div>

        {/* Options */}
        <div className="flex flex-wrap gap-6 border-t border-border pt-4">
          <Switch
            label="Spot-checkable"
            checked={form.isSpotCheckable}
            onChange={(v) => set('isSpotCheckable', v)}
          />
          <Switch
            label="Active"
            checked={form.isActive}
            onChange={(v) => set('isActive', v)}
          />
        </div>
      </div>
    </Modal>
  )
}
