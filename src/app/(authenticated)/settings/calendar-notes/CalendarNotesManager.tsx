'use client'

import { useState, useTransition } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  Empty,
  Field,
  FormFooter,
  Icon,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from '@/ds'
import {
  createCalendarNote,
  deleteCalendarNote,
  generateCalendarNotesWithAI,
  updateCalendarNote,
  type CalendarNote,
} from '@/app/actions/calendar-notes'
import { DEFAULT_CALENDAR_NOTE_COLOUR } from '@/lib/rota/shift-template-colours'
import { shiftIsoDate, toLocalIsoDate } from '@/lib/dateUtils'

type CalendarNoteFormState = {
  note_date: string
  end_date: string
  title: string
  notes: string
  color: string
  show_to_staff: boolean
}

type CalendarGeneratorState = {
  start_date: string
  end_date: string
  guidance: string
}

// London dates, not the host's: this renders on the UTC server first.
function getLocalIsoDate(date = new Date()): string {
  return toLocalIsoDate(date)
}

function addDaysIsoDate(baseDateIso: string, days: number): string {
  return shiftIsoDate(baseDateIso, days) ?? baseDateIso
}

// A colour staff pick and store on each note: data, not a styling token. One constant, so the
// form default and the fallback for a malformed stored value cannot drift apart, and it is the
// shared default every calendar screen uses (the first colour in the palette).
const DEFAULT_NOTE_COLOUR = DEFAULT_CALENDAR_NOTE_COLOUR

function createEmptyNoteForm(defaultDateIso?: string): CalendarNoteFormState {
  const baseDate = defaultDateIso ?? getLocalIsoDate()
  return {
    note_date: baseDate,
    end_date: baseDate,
    title: '',
    notes: '',
    color: DEFAULT_NOTE_COLOUR,
    show_to_staff: true,
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
  return DEFAULT_NOTE_COLOUR
}

export default function CalendarNotesManager({
  initialNotes,
  initialError,
  canManage = true,
  canGenerate = true,
}: {
  initialNotes: CalendarNote[]
  initialError: string | null
  /** Create, edit and delete. Read-only viewers still see the list. */
  canManage?: boolean
  /**
   * AI generation is gated separately and more tightly than editing: one run can
   * ask OpenAI for up to 120 notes and queue a Google write for each.
   */
  canGenerate?: boolean
}) {
  const todayIso = getLocalIsoDate()
  const [notes, setNotes] = useState<CalendarNote[]>(sortCalendarNotes(initialNotes))
  // Errors from saving, deleting or generating. A failed load is shown in the list card instead.
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [noteForm, setNoteForm] = useState<CalendarNoteFormState>(createEmptyNoteForm(todayIso))
  const [generatorForm, setGeneratorForm] = useState<CalendarGeneratorState>({
    start_date: todayIso,
    end_date: addDaysIsoDate(todayIso, 365),
    guidance: '',
  })
  const [isMutating, startMutatingTransition] = useTransition()
  const [isGenerating, startGenerateTransition] = useTransition()
  const [deleteTarget, setDeleteTarget] = useState<CalendarNote | null>(null)

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
      show_to_staff: note.show_to_staff,
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
      show_to_staff: noteForm.show_to_staff,
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
    <>
      {errorMessage && (
        <Alert tone="danger" title="Calendar notes">{errorMessage}</Alert>
      )}

      {(canManage || canGenerate) && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {canManage && (
            <Card>
              <CardHeader
                title={editingNoteId ? 'Edit Calendar Note' : 'New Calendar Note'}
                subtitle="Your own notes for holidays, campaigns, closures, and reminders"
              />
              <CardBody>
                <form onSubmit={handleNoteSave} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Start date" required>
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
                    </Field>
                    <Field label="End date" required>
                      <Input
                        type="date"
                        value={noteForm.end_date}
                        min={noteForm.note_date}
                        onChange={(event) => setNoteForm((current) => ({ ...current, end_date: event.target.value }))}
                        required
                      />
                    </Field>
                  </div>

                  <Field label="Title" required>
                    <Input
                      type="text"
                      placeholder="e.g. St Patrick's Day"
                      value={noteForm.title}
                      onChange={(event) => setNoteForm((current) => ({ ...current, title: event.target.value }))}
                      maxLength={160}
                      required
                    />
                  </Field>

                  <Field label="Colour">
                    <Input
                      type="color"
                      value={normalizeColor(noteForm.color)}
                      onChange={(event) => setNoteForm((current) => ({ ...current, color: event.target.value }))}
                    />
                  </Field>

                  <Field label="Notes">
                    <Textarea
                      rows={3}
                      placeholder="Optional detail for the calendar tooltip."
                      value={noteForm.notes}
                      onChange={(event) => setNoteForm((current) => ({ ...current, notes: event.target.value }))}
                      maxLength={4000}
                    />
                  </Field>

                  <Checkbox
                    label="Show to staff"
                    description="Staff see the title and dates on their My Shifts page. Untick to keep it to managers. It goes to the Google calendar either way."
                    checked={noteForm.show_to_staff}
                    onChange={(checked) => setNoteForm((current) => ({ ...current, show_to_staff: checked }))}
                  />

                  <FormFooter>
                    {editingNoteId && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => resetNoteForm(noteForm.note_date || todayIso)}
                        disabled={isMutating}
                      >
                        Cancel
                      </Button>
                    )}
                    <Button
                      type="submit"
                      variant="primary"
                      loading={isMutating}
                      icon={<Icon name="calendar" size={16} />}
                    >
                      {editingNoteId ? 'Save Changes' : 'Create Calendar Note'}
                    </Button>
                  </FormFooter>
                </form>
              </CardBody>
            </Card>
          )}

          {canGenerate && (
            <Card>
              <CardHeader title="Generate with AI" subtitle="Uses your OpenAI key from Settings" />
              <CardBody>
                <form onSubmit={handleGenerate} className="space-y-4">
                  <p className="text-sm text-text-muted">
                    Generate important dates between two dates, including major holidays and hospitality-relevant observances.
                  </p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Start date" required>
                      <Input
                        type="date"
                        value={generatorForm.start_date}
                        onChange={(event) => setGeneratorForm((current) => ({ ...current, start_date: event.target.value }))}
                        required
                      />
                    </Field>
                    <Field label="End date" required>
                      <Input
                        type="date"
                        value={generatorForm.end_date}
                        onChange={(event) => setGeneratorForm((current) => ({ ...current, end_date: event.target.value }))}
                        required
                      />
                    </Field>
                  </div>

                  <Field label="Extra guidance">
                    <Textarea
                      rows={4}
                      placeholder="Optional: include venue-specific reminders or campaign themes."
                      value={generatorForm.guidance}
                      onChange={(event) => setGeneratorForm((current) => ({ ...current, guidance: event.target.value }))}
                      maxLength={2000}
                    />
                  </Field>

                  <FormFooter>
                    <Button
                      type="submit"
                      variant="primary"
                      loading={isGenerating}
                      icon={<Icon name="sparkles" size={16} />}
                    >
                      Generate Notes
                    </Button>
                  </FormFooter>
                </form>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      <Card padding="none">
        <CardHeader title="Saved Calendar Notes" action={<Badge>{notes.length} total</Badge>} />

        {notes.length === 0 ? (
          // A failed load is an error, never shown as an empty list.
          initialError ? (
            <CardBody>
              <Alert tone="danger" title="Calendar notes">{initialError}</Alert>
            </CardBody>
          ) : (
            <Empty size="sm" title="No calendar notes yet" />
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dates</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead align="right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {notes.map((note) => (
                <TableRow key={note.id}>
                  <TableCell>{describeDateRange(note)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: normalizeColor(note.color) }}
                      />
                      <span className="font-medium">{note.title}</span>
                      {!note.show_to_staff && <Badge>Managers only</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge>{note.source === 'ai' ? 'AI' : 'Manual'}</Badge>
                  </TableCell>
                  <TableCell className="max-w-sm whitespace-normal text-text-muted">
                    <span className="line-clamp-2">{note.notes || '-'}</span>
                  </TableCell>
                  <TableCell align="right">
                    {canManage && (
                      <div className="inline-flex items-center gap-1">
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => beginEdit(note)}
                          disabled={isMutating}
                          icon={<Icon name="edit" size={14} />}
                        >
                          Edit
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setDeleteTarget(note)}
                          disabled={isMutating}
                          icon={<Icon name="trash" size={14} />}
                        >
                          Delete
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) handleDelete(deleteTarget)
        }}
        tone="danger"
        title="Delete Calendar Note"
        message={deleteTarget ? `Delete "${deleteTarget.title}" (${describeDateRange(deleteTarget)})?` : undefined}
        confirmLabel="Delete"
      />
    </>
  )
}
