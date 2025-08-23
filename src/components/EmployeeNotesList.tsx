'use client';

import { useSupabase } from '@/components/providers/SupabaseProvider';
import type { EmployeeNote } from '@/types/database';
import { UserCircleIcon } from '@heroicons/react/24/solid';
import { useEffect, useState, useCallback } from 'react';
import { formatDate } from '@/lib/dateUtils';

interface EmployeeNotesListProps {
  employeeId: string;
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

    const authorIds = [...new Set(notes.map((note: any) => note.created_by_user_id).filter(Boolean))] as string[];

    if (authorIds.length === 0) {
      const systemNotes = notes.map((note: any) => ({ ...note, author_name: 'System' }));
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
      const fallbackNotes = notes.map((note: any) => ({
        ...note,
        author_name: note.created_by_user_id ? `User (${note.created_by_user_id.substring(0, 6)}...)` : 'System'
      }));
      setNotesWithAuthors(fallbackNotes);
      setIsLoading(false);
      return;
    }

    const authorMap = new Map<string, string | null>();
    userProfiles?.forEach((profile: any) => {
      authorMap.set(profile.id, profile.full_name);
    });

    const finalNotes = notes.map((note: any) => {
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
                  <p className="mt-1 sm:mt-0.5 text-xs sm:text-sm text-gray-700 whitespace-pre-wrap break-words">{note.note_text}</p>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
} 