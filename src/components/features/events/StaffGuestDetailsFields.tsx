'use client'

import { Fieldset, Input, Select } from '@/ds'
import type { BookingQuestion } from '@/lib/events/booking-questions'

/**
 * One card per ticket for a booking staff take by phone, at the bar or on the event page:
 * the guest's name, their own mobile and the event's questions (BK-011, BK-013 and BK-141,
 * customer bookings review of 24 October 2026; owner decision D5).
 *
 * Every field may be left blank. Whatever is missing is saved as "details to follow" and the
 * booker can add it from their manage link, or staff from the event page later.
 */
export interface StaffGuestRow {
  id: string
  name: string
  phone: string
  answers: Record<string, string>
}

export function newStaffGuestRow(): StaffGuestRow {
  return { id: crypto.randomUUID(), name: '', phone: '', answers: {} }
}

/** Keeps one row per ticket, keeping what was typed for the tickets that remain. */
export function resizeStaffGuestRows(rows: StaffGuestRow[], seats: number): StaffGuestRow[] {
  const count = Number.isFinite(seats) ? Math.max(0, Math.min(20, Math.floor(seats))) : 0
  if (rows.length === count) return rows
  if (rows.length > count) return rows.slice(0, count)
  return [...rows, ...Array.from({ length: count - rows.length }, newStaffGuestRow)]
}

/** The rows as the server takes them (trimmed); the server drops an all-blank set. */
export function staffGuestRowsForSubmit(rows: StaffGuestRow[]): Array<{ id: string; name: string; phone?: string; answers: Record<string, string> }> {
  return rows.map((row) => ({
    id: row.id,
    name: row.name.trim(),
    ...(row.phone.trim() ? { phone: row.phone.trim() } : {}),
    answers: Object.fromEntries(Object.entries(row.answers).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value !== '')),
  }))
}

interface StaffGuestDetailsFieldsProps {
  rows: StaffGuestRow[]
  questions: BookingQuestion[]
  /** The event's own setting says every ticket should carry guest details (BK-014). */
  required: boolean
  disabled?: boolean
  onChange: (rows: StaffGuestRow[]) => void
  /** Prefix for field ids, so two forms on one page never share an id. */
  idPrefix: string
}

export function StaffGuestDetailsFields({ rows, questions, required, disabled, onChange, idPrefix }: StaffGuestDetailsFieldsProps): React.ReactElement | null {
  if (rows.length === 0) return null
  const update = (id: string, change: Partial<StaffGuestRow>): void => {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...change } : row)))
  }
  const hint = required
    ? 'This event asks for each guest. Take what the guest can give now; anything left blank follows later from the booker\'s link.'
    : 'Optional. Anything left blank can be added later.'

  return (
    <Fieldset legend={required ? 'Guest details for each ticket' : 'Guest details (optional)'} hint={hint}>
      <div className="space-y-3">
        {rows.map((row, index) => (
          <div key={row.id} className="space-y-2 rounded-default border border-border p-3">
            <p className="text-sm font-medium text-text">Ticket {index + 1}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                id={`${idPrefix}-name-${index}`}
                label="Guest name"
                value={row.name}
                maxLength={120}
                disabled={disabled}
                onChange={(event) => update(row.id, { name: event.target.value })}
              />
              <Input
                id={`${idPrefix}-phone-${index}`}
                label="Guest mobile (optional, this booking only)"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={row.phone}
                maxLength={40}
                disabled={disabled}
                onChange={(event) => update(row.id, { phone: event.target.value })}
              />
            </div>
            {questions.map((question) => {
              const fieldId = `${idPrefix}-answer-${index}-${question.id}`
              const value = row.answers[question.id] ?? ''
              const label = question.required ? `${question.label} (required, can follow)` : question.label
              const setValue = (next: string): void => update(row.id, { answers: { ...row.answers, [question.id]: next } })
              if (question.type === 'text') {
                return <Input key={question.id} id={fieldId} label={label} value={value} maxLength={2000} disabled={disabled} onChange={(event) => setValue(event.target.value)} />
              }
              const options = question.type === 'yes_no' ? ['yes', 'no'] : question.options ?? []
              return (
                <Select key={question.id} id={fieldId} label={label} value={value} disabled={disabled} onChange={(event) => setValue(event.target.value)}>
                  <option value="">Not given yet</option>
                  {options.map((option) => (
                    <option key={option} value={option}>{option === 'yes' ? 'Yes' : option === 'no' ? 'No' : option}</option>
                  ))}
                </Select>
              )
            })}
          </div>
        ))}
      </div>
    </Fieldset>
  )
}
