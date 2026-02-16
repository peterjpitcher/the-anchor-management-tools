'use client'

import { useState, useTransition } from 'react'
import {
  CalendarDaysIcon,
  PencilSquareIcon,
  SparklesIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import { Button } from '@/components/ui-v2/forms/Button'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Badge } from '@/components/ui-v2/display/Badge'
import { toast } from '@/components/ui-v2/feedback/Toast'
import {
  createCalendarNote,
  deleteCalendarNote,
  generateCalendarNotesWithAI,
  updateCalendarNote,
  type CalendarNote,
} from '@/app/actions/calendar-notes'

type CalendarNoteFormState = {
  note_date: string
  end_date: string
  title: string
  notes: string
  color: string
}

type CalendarGeneratorState = {
  start_date: string
  end_date: string
  guidance: string
}

function getLocalIsoDate(date = new Date()): string {
  const copy = new Date(date)
  const offsetMinutes = copy.getTimezoneOffset()
  copy.setMinutes(copy.getMinutes() - offsetMinutes)
  return copy.toISOString().slice(0, 10)
}

function addDaysIsoDate(baseDateIso: string, days: number): string {
  const date = new Date(`${baseDateIso}T00:00:00`)
  date.setDate(date.getDate() + days)
  return getLocalIsoDate(date)
}

function createEmptyNoteForm(defaultDateIso?: string): CalendarNoteFormState {
  const baseDate = defaultDateIso ?? getLocalIsoDate()
  return {
    note_date: baseDate,
    end_date: baseDate,
    title: '',
    notes: '',
    color: '#0EA5E9',
  }
}

function sortCalendarNotes(notes: CalendarNote[]): CalendarNote[] {
  return [...notes].sort((a, b) => {
    if (a.note_date !== b.note_date) return a.note_date.localeCompare(b.note_date)
    if (a.end_date !== b.end_date) return a.end_date.localeCompare(b.end_date)
    return a.title.localeCompare(b.title)
  })
}

function describeDateRange(note: CalendarNote): string {
  if (note.note_date === note.end_date) return note.note_date
  return `${note.note_date} to ${note.end_date}`
}

function normalizeColor(input: string): string {
  const trimmed = input.trim()
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return trimmed.toUpperCase()
  return '#0EA5E9'
}

export default function CalendarNotesManager({
  initialNotes,
  initialError,
}: {
  initialNotes: CalendarNote[]
  initialError: string | null
}) {
  const todayIso = getLocalIsoDate()
  const [notes, setNotes] = useState<CalendarNote[]>(sortCalendarNotes(initialNotes))
  const [errorMessage, setErrorMessage] = useState<string | null>(initialError)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [noteForm, setNoteForm] = useState<CalendarNoteFormState>(createEmptyNoteForm(todayIso))
  const [generatorForm, setGeneratorForm] = useState<CalendarGeneratorState>({
    start_date: todayIso,
    end_date: addDaysIsoDate(todayIso, 365),
    guidance: '',
  })
  const [isMutating, startMutatingTransition] = useTransition()
  const [isGenerating, startGenerateTransition] = useTransition()

  function resetNoteForm(nextDefaultDate = todayIso) {
    setEditingNoteId(null)
    setNoteForm(createEmptyNoteForm(nextDefaultDate))
  }

  function beginEdit(note: CalendarNote) {
    setEditingNoteId(note.id)
    setNoteForm({
      note_date: note.note_date,
      end_date: note.end_date,
      title: note.title,
      notes: note.notes ?? '',
      color: note.color,
    })
    setErrorMessage(null)
  }

  function upsertNotes(newNotes: CalendarNote[]) {
    setNotes((current) => {
      const next = new Map(current.map((note) => [note.id, note]))
      for (const note of newNotes) {
        next.set(note.id, note)
      }
      return sortCalendarNotes(Array.from(next.values()))
    })
  }

  function removeNoteFromState(noteId: string) {
    setNotes((current) => current.filter((note) => note.id !== noteId))
    if (editingNoteId === noteId) {
      resetNoteForm()
    }
  }

  function handleNoteSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)

    if (!noteForm.note_date || !noteForm.title.trim()) {
      setErrorMessage('Date and title are required.')
      return
    }

    if (noteForm.end_date < noteForm.note_date) {
      setErrorMessage('End date must be the same or after start date.')
      return
    }

    const payload = {
      note_date: noteForm.note_date,
      end_date: noteForm.end_date,
      title: noteForm.title.trim(),
      notes: noteForm.notes.trim() || null,
      color: normalizeColor(noteForm.color),
    }

    startMutatingTransition(async () => {
      const result = editingNoteId
        ? await updateCalendarNote(editingNoteId, payload)
        : await createCalendarNote(payload)

      if (result.error || !result.data) {
        const message = result.error ?? 'Failed to save calendar note.'
        setErrorMessage(message)
        toast.error(message)
        return
      }

      upsertNotes([result.data])
      resetNoteForm(result.data.note_date)
      toast.success(editingNoteId ? 'Calendar note updated.' : 'Calendar note created.')
    })
  }

  function handleDelete(note: CalendarNote) {
    const confirmed = window.confirm(`Delete "${note.title}" (${describeDateRange(note)})?`)
    if (!confirmed) return

    setErrorMessage(null)
    startMutatingTransition(async () => {
      const result = await deleteCalendarNote(note.id)
      if (result.error) {
        setErrorMessage(result.error)
        toast.error(result.error)
        return
      }

      removeNoteFromState(note.id)
      toast.success('Calendar note deleted.')
    })
  }

  function handleGenerate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)

    if (!generatorForm.start_date || !generatorForm.end_date) {
      setErrorMessage('Choose a start and end date for AI generation.')
      return
    }

    startGenerateTransition(async () => {
      const result = await generateCalendarNotesWithAI({
        start_date: generatorForm.start_date,
        end_date: generatorForm.end_date,
        guidance: generatorForm.guidance.trim() || null,
      })

      if (result.error) {
        setErrorMessage(result.error)
        toast.error(result.error)
        return
      }

      const insertedNotes = result.data ?? []
      if (insertedNotes.length > 0) {
        upsertNotes(insertedNotes)
      }

      const insertedCount = result.insertedCount ?? insertedNotes.length
      const skippedCount = result.skippedCount ?? 0
      toast.success(`Generated ${insertedCount} notes${skippedCount > 0 ? ` (${skippedCount} skipped)` : ''}.`)
    })
  }

  return (
    <div className="space-y-8">
      {errorMessage && (
        <Alert variant="error" title="Calendar notes" description={errorMessage} />
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-lg border border-gray-200 p-4 sm:p-5">
          <h3 className="text-base font-semibold text-gray-900">
            {editingNoteId ? 'Edit calendar note' : 'Add manual calendar note'}
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            Add your own notes for holidays, campaigns, closures, and reminders.
          </p>

          <form onSubmit={handleNoteSave} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormGroup label="Start date" required>
                <Input
                  type="date"
                  value={noteForm.note_date}
                  onChange={(event) => {
                    const nextStart = event.target.value
                    setNoteForm((current) => ({
                      ...current,
                      note_date: nextStart,
                      end_date: current.end_date < nextStart ? nextStart : current.end_date,
                    }))
                  }}
                  required
                />
              </FormGroup>
              <FormGroup label="End date" required>
                <Input
                  type="date"
                  value={noteForm.end_date}
                  min={noteForm.note_date}
                  onChange={(event) => setNoteForm((current) => ({ ...current, end_date: event.target.value }))}
                  required
                />
              </FormGroup>
            </div>

            <FormGroup label="Title" required>
              <Input
                type="text"
                placeholder="e.g. St Patrick's Day"
                value={noteForm.title}
                onChange={(event) => setNoteForm((current) => ({ ...current, title: event.target.value }))}
                maxLength={160}
                required
              />
            </FormGroup>

            <FormGroup label="Color">
              <Input
                type="color"
                value={normalizeColor(noteForm.color)}
                onChange={(event) => setNoteForm((current) => ({ ...current, color: event.target.value }))}
              />
            </FormGroup>

            <FormGroup label="Notes">
              <Textarea
                rows={3}
                placeholder="Optional detail for the calendar tooltip."
                value={noteForm.notes}
                onChange={(event) => setNoteForm((current) => ({ ...current, notes: event.target.value }))}
                maxLength={4000}
              />
            </FormGroup>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {editingNoteId && (
                <Button
                  variant="ghost"
                  onClick={() => resetNoteForm(noteForm.note_date || todayIso)}
                  disabled={isMutating}
                >
                  Cancel
                </Button>
              )}
              <Button
                type="submit"
                loading={isMutating}
                leftIcon={<CalendarDaysIcon className="h-4 w-4" />}
              >
                {editingNoteId ? 'Save changes' : 'Add note'}
              </Button>
            </div>
          </form>
        </section>

        <section className="rounded-lg border border-gray-200 p-4 sm:p-5">
          <h3 className="text-base font-semibold text-gray-900">Generate with AI</h3>
          <p className="mt-1 text-sm text-gray-600">
            Generate important dates between two dates, including major holidays and hospitality-relevant observances.
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Uses your OpenAI key from Settings.
          </p>

          <form onSubmit={handleGenerate} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormGroup label="Start date" required>
                <Input
                  type="date"
                  value={generatorForm.start_date}
                  onChange={(event) => setGeneratorForm((current) => ({ ...current, start_date: event.target.value }))}
                  required
                />
              </FormGroup>
              <FormGroup label="End date" required>
                <Input
                  type="date"
                  value={generatorForm.end_date}
                  onChange={(event) => setGeneratorForm((current) => ({ ...current, end_date: event.target.value }))}
                  required
                />
              </FormGroup>
            </div>

            <FormGroup label="Extra guidance">
              <Textarea
                rows={4}
                placeholder="Optional: include venue-specific reminders or campaign themes."
                value={generatorForm.guidance}
                onChange={(event) => setGeneratorForm((current) => ({ ...current, guidance: event.target.value }))}
                maxLength={2000}
              />
            </FormGroup>

            <div className="flex justify-end">
              <Button
                type="submit"
                variant="secondary"
                loading={isGenerating}
                leftIcon={<SparklesIcon className="h-4 w-4" />}
              >
                Generate notes
              </Button>
            </div>
          </form>
        </section>
      </div>

      <section className="rounded-lg border border-gray-200">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">Saved calendar notes</h3>
          <Badge variant="secondary">{notes.length} total</Badge>
        </div>

        {notes.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-gray-500">
            No calendar notes yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Dates</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Title</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Source</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Notes</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {notes.map((note) => (
                  <tr key={note.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{describeDateRange(note)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: normalizeColor(note.color) }}
                        />
                        <span className="text-sm font-medium text-gray-900">{note.title}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Badge variant={note.source === 'ai' ? 'secondary' : 'default'}>
                        {note.source === 'ai' ? 'AI' : 'Manual'}
                      </Badge>
                    </td>
                    <td className="max-w-sm px-4 py-3 text-sm text-gray-600">
                      <span className="line-clamp-2">{note.notes || '—'}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => beginEdit(note)}
                          disabled={isMutating}
                          leftIcon={<PencilSquareIcon className="h-3.5 w-3.5" />}
                        >
                          Edit
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => handleDelete(note)}
                          disabled={isMutating}
                          leftIcon={<TrashIcon className="h-3.5 w-3.5" />}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
