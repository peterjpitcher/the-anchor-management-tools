import type { EmployeeNoteWithAuthor } from '@/app/actions/employeeDetails'
import { formatDate } from '@/lib/dateUtils'
import { UserCircleIcon } from '@heroicons/react/24/solid'

interface EmployeeNotesListProps {
  notes: EmployeeNoteWithAuthor[]
}

export default function EmployeeNotesList({ notes }: EmployeeNotesListProps) {
  if (!notes || notes.length === 0) {
    return <p className="text-sm text-gray-500">No notes recorded for this employee yet.</p>
  }

  return (
    <div className="flow-root">
      <ul role="list" className="-mb-8">
        {notes.map((note, noteIdx) => (
          <li key={note.note_id}>
            <div className="relative pb-8">
              {noteIdx !== notes.length - 1 ? (
                <span className="absolute top-3 sm:top-4 left-3 sm:left-4 -ml-px h-full w-0.5 bg-gray-200" aria-hidden="true" />
              ) : null}
              <div className="relative flex space-x-2 sm:space-x-3">
                <div className="flex-shrink-0">
                  <span className="h-6 w-6 sm:h-8 sm:w-8 rounded-full bg-gray-400 flex items-center justify-center ring-4 sm:ring-8 ring-white">
                    <UserCircleIcon className="h-3 w-3 sm:h-5 sm:w-5 text-white" aria-hidden="true" />
                  </span>
                </div>
                <div className="min-w-0 flex-1 pt-0.5 sm:pt-1.5">
                  <div className="text-xs sm:text-sm text-gray-500">
                    <span className="font-medium text-gray-900">{note.author_name}</span>
                    <span className="block sm:inline sm:ml-2 text-gray-500">
                      {formatDate(note.created_at)}
                    </span>
                  </div>
                  <p className="mt-1 sm:mt-0.5 text-xs sm:text-sm text-gray-700 whitespace-pre-wrap break-words">
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
