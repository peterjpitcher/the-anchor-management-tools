import type { EmployeeNoteWithAuthor } from '@/app/actions/employeeDetails'
import { formatDate } from '@/lib/dateUtils'
import { Empty, Icon } from '@/ds'

interface EmployeeNotesListProps {
  notes: EmployeeNoteWithAuthor[]
}

export default function EmployeeNotesList({ notes }: EmployeeNotesListProps) {
  if (!notes || notes.length === 0) {
    return <Empty size="sm" title="No notes yet" description="No notes recorded for this employee yet." />
  }

  return (
    <div className="flow-root">
      <ul role="list" className="-mb-8">
        {notes.map((note, noteIdx) => (
          <li key={note.note_id}>
            <div className="relative pb-8">
              {noteIdx !== notes.length - 1 ? (
                <span className="absolute top-3 sm:top-4 left-3 sm:left-4 -ml-px h-full w-0.5 bg-border" aria-hidden="true" />
              ) : null}
              <div className="relative flex space-x-2 sm:space-x-3">
                <div className="flex-shrink-0">
                  <span className="h-6 w-6 sm:h-8 sm:w-8 rounded-full bg-text-subtle flex items-center justify-center ring-4 sm:ring-8 ring-surface">
                    <Icon name="userCircle" size={12} className="sm:h-5 sm:w-5 text-on-dark" />
                  </span>
                </div>
                <div className="min-w-0 flex-1 pt-0.5 sm:pt-1.5">
                  <div className="text-xs sm:text-sm text-text-muted">
                    <span className="font-medium text-text">{note.author_name}</span>
                    <span className="block sm:inline sm:ml-2 text-text-muted">
                      {formatDate(note.created_at)}
                    </span>
                  </div>
                  <p className="mt-1 sm:mt-0.5 text-xs sm:text-sm text-text whitespace-pre-wrap break-words">
                    {note.note_text}
                  </p>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
