// Removed 'use client'; directive
import { supabase } from '@/lib/supabase';
import type { EmployeeNote } from '@/types/database';
import { UserCircleIcon } from '@heroicons/react/24/solid';
// Removed useEffect and useState as this is a Server Component

interface EmployeeNotesListProps {
  employeeId: string;
}

// Interface for the user data - Please confirm 'profiles' is the correct table name
// and 'full_name' is the correct column for the user's name.
interface UserProfile {
  id: string;
  full_name: string | null; // Placeholder: confirm this column name
}

interface DisplayEmployeeNote extends EmployeeNote {
  author_name?: string | null;
}

async function getNotesWithAuthorNames(employeeId: string): Promise<DisplayEmployeeNote[] | null> {
  // console.log(`[EmployeeNotesList] Fetching notes for employeeId: ${employeeId}`);
  const { data: notes, error: notesError } = await supabase
    .from('employee_notes')
    .select('*')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });

  if (notesError) {
    // console.error('[EmployeeNotesList] Error fetching employee notes:', notesError);
    return null;
  }

  if (!notes || notes.length === 0) {
    // console.log('[EmployeeNotesList] No notes found.');
    return [];
  }
  // console.log('[EmployeeNotesList] Fetched notes:', notes);

  const authorIds = [...new Set(notes.map(note => note.created_by).filter(id => id !== null))] as string[];
  // console.log('[EmployeeNotesList] Extracted authorIds:', authorIds);

  if (authorIds.length === 0) {
    // console.log('[EmployeeNotesList] No authorIds to fetch profiles for.');
    return notes.map(note => ({ ...note, author_name: 'System' }));
  }

  // console.log('[EmployeeNotesList] Fetching profiles for authorIds:', authorIds);
  const { data: userProfiles, error: profilesError } = await supabase
    .from('profiles') 
    .select('id, full_name') 
    .in('id', authorIds);

  if (profilesError) {
    // console.error('[EmployeeNotesList] Error fetching user profiles:', profilesError);
    return notes.map(note => ({ ...note, author_name: `User (${note.created_by?.substring(0,6)}...)`}));
  }
  // console.log('[EmployeeNotesList] Fetched userProfiles:', userProfiles);

  const authorMap = new Map<string, string | null>();
  userProfiles?.forEach(profile => {
    authorMap.set(profile.id, profile.full_name);
  });
  // console.log('[EmployeeNotesList] Constructed authorMap:', authorMap);

  const notesWithAuthors = notes.map(note => {
    const mappedName = note.created_by ? authorMap.get(note.created_by) : undefined;
    const author_name = mappedName || (note.created_by ? `User (${note.created_by.substring(0,6)}...)` : 'System');
    // console.log(`[EmployeeNotesList] Note ID: ${note.note_id}, created_by: ${note.created_by}, mappedName: ${mappedName}, final author_name: ${author_name}`);
    return {
      ...note,
      author_name
    };
  });
  // console.log('[EmployeeNotesList] Final notesWithAuthors:', notesWithAuthors);

  return notesWithAuthors;
}

export default async function EmployeeNotesList({ employeeId }: EmployeeNotesListProps) {
  const notesWithAuthors = await getNotesWithAuthorNames(employeeId);

  if (!notesWithAuthors) {
    return <p className="text-sm text-red-500">Could not load notes.</p>;
  }

  if (notesWithAuthors.length === 0) {
    return <p className="text-sm text-gray-500">No notes recorded for this employee yet.</p>;
  }

  return (
    <div className="flow-root">
      <ul role="list" className="-mb-8">
        {notesWithAuthors.map((note, noteIdx) => (
          <li key={note.note_id}>
            <div className="relative pb-8">
              {noteIdx !== notesWithAuthors.length - 1 ? (
                <span className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-gray-200" aria-hidden="true" />
              ) : null}
              <div className="relative flex space-x-3">
                <div>
                  <span className="h-8 w-8 rounded-full bg-gray-400 flex items-center justify-center ring-8 ring-white">
                    <UserCircleIcon className="h-5 w-5 text-white" aria-hidden="true" />
                  </span>
                </div>
                <div className="min-w-0 flex-1 pt-1.5">
                  <div className="text-sm text-gray-500">
                    {note.author_name} 
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