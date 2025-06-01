import { supabase } from '@/lib/supabase';
import type { EmployeeNote } from '@/types/database';
import { UserCircleIcon } from '@heroicons/react/24/solid';

interface EmployeeNotesListProps {
  employeeId: string;
}

async function getEmployeeNotes(employeeId: string): Promise<EmployeeNote[] | null> {
  const { data, error } = await supabase
    .from('employee_notes')
    .select('*') // Removed the join: author:profiles(full_name, avatar_url)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching employee notes:', error);
    return null;
  }
  return data; // No longer need to cast as any, since it's just EmployeeNote[]
}

// No longer need DisplayEmployeeNote if not joining author details
// interface DisplayEmployeeNote extends EmployeeNote {
//   author?: {
//     full_name?: string | null;
//     avatar_url?: string | null;
//   } | null;
// }

export default async function EmployeeNotesList({ employeeId }: EmployeeNotesListProps) {
  const notes = await getEmployeeNotes(employeeId); // Type is now EmployeeNote[] | null

  if (!notes) {
    return <p className="text-sm text-red-500">Could not load notes.</p>;
  }

  if (notes.length === 0) {
    return <p className="text-sm text-gray-500">No notes recorded for this employee yet.</p>;
  }

  return (
    <div className="flow-root">
      <ul role="list" className="-mb-8">
        {notes.map((note, noteIdx) => (
          <li key={note.note_id}>
            <div className="relative pb-8">
              {noteIdx !== notes.length - 1 ? (
                <span className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-gray-200" aria-hidden="true" />
              ) : null}
              <div className="relative flex space-x-3">
                <div>
                  {/* Default user icon, as author details are not fetched */}
                  <span className="h-8 w-8 rounded-full bg-gray-400 flex items-center justify-center ring-8 ring-white">
                    <UserCircleIcon className="h-5 w-5 text-white" aria-hidden="true" />
                  </span>
                </div>
                <div className="min-w-0 flex-1 pt-1.5">
                  <div className="text-sm text-gray-500">
                    {/* Display created_by UUID if available, otherwise 'System' */}
                    {note.created_by ? `User (${note.created_by.substring(0, 6)}...)` : 'System'}
                    <span className="ml-2 font-medium text-gray-900">
                      {new Date(note.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-gray-700 whitespace-pre-wrap">{note.note_text}</p>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
} 