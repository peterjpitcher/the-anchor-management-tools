'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Badge, Button, Card, CardBody, Spinner, Textarea, toast } from '@/ds'
import { addMaintenanceNote, getMaintenanceTimeline } from '@/app/actions/maintenance'
import type { MaintenanceTimelineCursor, MaintenanceTimelineEntry } from '@/services/maintenance'
import {
  formatMaintenanceTimestamp,
  maintenanceActorLabel,
  maintenanceHistoryFieldLabel,
  maintenanceHistoryValueLabel,
} from './maintenanceDisplay'

export interface MaintenanceTimelineProps {
  itemId: string
}

/**
 * The item's trail. Notes are the primary list because they are what a person
 * wrote; field changes and photo events sit behind a collapsed toggle, following
 * the recruitment drawer's precedent.
 *
 * A read failure is shown as an explicit error. An empty trail and a broken one
 * must never look the same.
 */
export function MaintenanceTimeline({ itemId }: MaintenanceTimelineProps): React.JSX.Element {
  const [entries, setEntries] = useState<MaintenanceTimelineEntry[]>([])
  const [cursor, setCursor] = useState<MaintenanceTimelineCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [noteDraft, setNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [showSystem, setShowSystem] = useState(false)

  const noteRef = useRef<HTMLTextAreaElement>(null)

  const loadFirstPage = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const result = await getMaintenanceTimeline({ itemId })
    setLoading(false)

    if (!result.success || !result.data) {
      setLoadError(result.error ?? 'Could not load the history for this item.')
      return
    }

    setEntries(result.data.entries)
    setCursor(result.data.nextCursor)
    setHasMore(result.data.hasMore)
  }, [itemId])

  useEffect(() => {
    void loadFirstPage()
  }, [loadFirstPage])

  const loadOlder = useCallback(async () => {
    if (!cursor) return
    setLoadingOlder(true)
    const result = await getMaintenanceTimeline({ itemId, cursor })
    setLoadingOlder(false)

    if (!result.success || !result.data) {
      setLoadError(result.error ?? 'Could not load older entries.')
      return
    }

    setEntries(current => [...current, ...result.data!.entries])
    setCursor(result.data.nextCursor)
    setHasMore(result.data.hasMore)
  }, [cursor, itemId])

  async function handleAddNote(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (savingNote) return

    const content = noteDraft.trim()
    if (!content) {
      setNoteError('Write something before saving the note')
      noteRef.current?.focus()
      return
    }

    setNoteError(null)
    setSavingNote(true)
    const result = await addMaintenanceNote({ itemId, content })
    setSavingNote(false)

    if (!result.success || !result.data) {
      // The draft is kept so a retry does not mean typing it again.
      setNoteError(result.error ?? 'Could not save that note. Please try again.')
      noteRef.current?.focus()
      return
    }

    const note = result.data
    setEntries(current => [
      {
        kind: 'note',
        id: note.id,
        occurredAt: note.createdAt,
        actorEmail: note.createdByEmail,
        note,
      },
      ...current,
    ])
    setNoteDraft('')
    setAnnouncement('Note added')
    toast.success('Note added')
  }

  const notes = entries.filter(
    (entry): entry is Extract<MaintenanceTimelineEntry, { kind: 'note' }> => entry.kind === 'note'
  )
  const systemEvents = entries.filter(
    (entry): entry is Exclude<MaintenanceTimelineEntry, { kind: 'note' }> => entry.kind !== 'note'
  )

  return (
    <Card>
      <CardBody>
        <h2 className="text-sm font-semibold text-text">History</h2>

        <form onSubmit={handleAddNote} noValidate className="mt-3">
          <Textarea
            ref={noteRef}
            label="Add a note"
            value={noteDraft}
            onChange={event => setNoteDraft(event.target.value)}
            rows={3}
            maxLength={5000}
            error={noteError ?? undefined}
            placeholder="What has happened, or what still needs doing"
          />
          <div className="mt-2">
            <Button type="submit" size="sm" loading={savingNote} disabled={savingNote}>
              Save note
            </Button>
          </div>
        </form>

        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>

        {loadError && (
          <div className="mt-4">
            <Alert tone="danger" title="Could not load the history">
              <p>{loadError}</p>
              <p className="mt-2">
                <Button size="sm" onClick={() => void loadFirstPage()}>
                  Try again
                </Button>
              </p>
            </Alert>
          </div>
        )}

        {loading ? (
          <div className="mt-4 flex items-center gap-2 text-[13px] text-text-muted">
            <Spinner size="sm" />
            <span>Loading the history</span>
          </div>
        ) : (
          !loadError && (
            <div className="mt-4 space-y-4">
              <section aria-label="Notes">
                {notes.length === 0 ? (
                  <p className="text-[13px] text-text-muted">
                    No notes yet. Anything you write here stays with the item.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {notes.map(entry => (
                      <li key={entry.id} className="border-l-2 border-border pl-3">
                        <p className="whitespace-pre-wrap text-[13px] text-text">
                          {entry.note.content}
                        </p>
                        <p className="mt-1 text-xs text-text-muted">
                          {maintenanceActorLabel(entry.actorEmail)}
                          {', '}
                          {formatMaintenanceTimestamp(entry.occurredAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-label="System events">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowSystem(current => !current)}
                  aria-expanded={showSystem}
                  aria-controls="maintenance-system-events"
                >
                  {showSystem ? 'Hide system events' : `Show system events (${systemEvents.length})`}
                </Button>

                <div id="maintenance-system-events" hidden={!showSystem} className="mt-2">
                  {systemEvents.length === 0 ? (
                    <p className="text-[13px] text-text-muted">Nothing recorded yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {systemEvents.map(entry => (
                        <li key={entry.id} className="border-l-2 border-border pl-3">
                          {entry.kind === 'history' ? (
                            <p className="text-[13px] text-text">
                              {maintenanceHistoryFieldLabel(entry.history.field)} changed from{' '}
                              <span className="font-medium">
                                {maintenanceHistoryValueLabel(
                                  entry.history.field,
                                  entry.history.oldValue
                                )}
                              </span>{' '}
                              to{' '}
                              <span className="font-medium">
                                {maintenanceHistoryValueLabel(
                                  entry.history.field,
                                  entry.history.newValue
                                )}
                              </span>
                            </p>
                          ) : (
                            <p className="flex flex-wrap items-center gap-2 text-[13px] text-text">
                              <span>Photo {entry.photo.fileName ?? 'added'}</span>
                              <Badge tone={entry.photo.redactedAt ? 'warning' : 'neutral'}>
                                {entry.photo.redactedAt ? 'Redacted' : entry.photo.state}
                              </Badge>
                            </p>
                          )}
                          <p className="mt-1 text-xs text-text-muted">
                            {maintenanceActorLabel(entry.actorEmail)}
                            {', '}
                            {formatMaintenanceTimestamp(entry.occurredAt)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              {hasMore && (
                <Button size="sm" onClick={() => void loadOlder()} loading={loadingOlder}>
                  Load older
                </Button>
              )}
            </div>
          )
        )}
      </CardBody>
    </Card>
  )
}

export default MaintenanceTimeline
