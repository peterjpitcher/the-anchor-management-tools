'use client';

import { useSupabase } from '@/components/providers/SupabaseProvider';
import type { EmployeeNote } from '@/types/database';
import { UserCircleIcon } from '@heroicons/react/24/solid';
import { useEffect, useState, useCallback } from 'react';
import { formatDate } from '@/lib/dateUtils';

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

export default function EmployeeNotesList({ employeeId }: EmployeeNotesListProps) {
  const supabase = useSupabase();
  const [notesWithAuthors, setNotesWithAuthors] = useState<DisplayEmployeeNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getNotesWithAuthorNames = useCallback(async (id: string): Promise<void> => {
    setIsLoading(true);
    setError(null);

    const { data: notes, error: notesError } = await supabase
      .from('employee_notes')
      .select('*')
      .eq('employee_id', id)
      .order('created_at', { ascending: false });

    if (notesError) {
      console.error('[EmployeeNotesList] Error fetching employee notes:', notesError);
      setError('Could not load notes.');
      setIsLoading(false);
      return;
    }

    if (!notes || notes.length === 0) {
      setNotesWithAuthors([]);
      setIsLoading(false);
      return;
    }

    const authorIds = [...new Set(notes.map(note => note.created_by_user_id).filter(Boolean))] as string[];

    if (authorIds.length === 0) {
      const systemNotes = notes.map(note => ({ ...note, author_name: 'System' }));
      setNotesWithAuthors(systemNotes);
      setIsLoading(false);
      return;
    }

    const { data: userProfiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', authorIds);

    if (profilesError) {
      console.error('[EmployeeNotesList] Error fetching user profiles:', profilesError);
      // Still show notes, but with a fallback name
      const fallbackNotes = notes.map(note => ({
        ...note,
        author_name: note.created_by_user_id ? `User (${note.created_by_user_id.substring(0, 6)}...)` : 'System'
      }));
      setNotesWithAuthors(fallbackNotes);
      setIsLoading(false);
      return;
    }

    const authorMap = new Map<string, string | null>();
    userProfiles?.forEach(profile => {
      authorMap.set(profile.id, profile.full_name);
    });

    const finalNotes = notes.map(note => {
      const mappedName = note.created_by_user_id ? authorMap.get(note.created_by_user_id) : undefined;
      const author_name = mappedName || (note.created_by_user_id ? `User (${note.created_by_user_id.substring(0, 6)}...)` : 'System');
      return { ...note, author_name };
    });
    
    setNotesWithAuthors(finalNotes);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (employeeId) {
      getNotesWithAuthorNames(employeeId);
    }
  }, [employeeId, getNotesWithAuthorNames]);

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading notes...</p>;
  }
  
  if (error) {
    return <p className="text-sm text-red-500">{error}</p>;
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
                      {formatDate(note.created_at)}
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