'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui-v2/forms/Button'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Badge } from '@/components/ui-v2/display/Badge'
import { addHiringNoteAction } from '@/actions/hiring-notes'
import type { HiringNoteWithAuthor } from '@/lib/hiring/notes'
import { formatDate } from '@/lib/utils'

interface HiringNotesPanelProps {
  entityType: 'candidate' | 'application'
  entityId: string
  canEdit: boolean
  initialNotes: HiringNoteWithAuthor[]
}

function formatAuthor(note: HiringNoteWithAuthor) {
  const first = note.author?.first_name || ''
  const last = note.author?.last_name || ''
  const name = `${first} ${last}`.trim()
  if (name) return name
  return note.author?.email || 'Unknown'
}

export function HiringNotesPanel({ entityType, entityId, canEdit, initialNotes }: HiringNotesPanelProps) {
  const [notes, setNotes] = useState<HiringNoteWithAuthor[]>(initialNotes)
  const [noteText, setNoteText] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const handleAddNote = async () => {
    if (!noteText.trim()) {
      toast.error('Enter a note before saving')
      return
    }

    setIsSaving(true)
    try {
      const result = await addHiringNoteAction({ entityType, entityId, content: noteText })
      if (!result.success || !result.data) {
        toast.error(result.error || 'Failed to save note')
        return
      }

      setNotes((prev) => [result.data, ...prev])
      setNoteText('')
      toast.success('Note added')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="bg-white shadow rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium text-gray-900">Notes</h3>
        <Badge variant="secondary" size="sm">Internal</Badge>
      </div>

      {canEdit && (
        <div className="space-y-3">
          <Textarea
            rows={3}
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            placeholder="Add a private note..."
          />
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={handleAddNote} loading={isSaving}>
              Add note
            </Button>
          </div>
        </div>
      )}

      {notes.length === 0 ? (
        <p className="text-sm text-gray-500">No notes yet.</p>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <div key={note.id} className="rounded-md border border-gray-200 p-3">
              <div className="text-xs text-gray-500">
                <span className="font-medium text-gray-700">{formatAuthor(note)}</span>
                <span className="ml-2">{formatDate(note.created_at)}</span>
              </div>
              <div className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">
                {note.content}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
