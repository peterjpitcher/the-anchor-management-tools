'use client';

import React, { useState, useEffect, FormEvent } from 'react';
import { getEmployeeList, addEmployeeNote } from '@/app/actions/employeeActions';
import type { NoteFormState } from '@/types/actions';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button'; // Assuming your Button component path

interface EmployeeOption {
  id: string;
  name: string;
}

interface AddNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Optional: Pass a default employeeId if the modal is opened from a specific employee context
  defaultEmployeeId?: string; 
}

export default function AddNoteModal({ isOpen, onClose, defaultEmployeeId }: AddNoteModalProps) {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(defaultEmployeeId || '');
  const [noteText, setNoteText] = useState<string>('');
  const [formState, setFormState] = useState<NoteFormState>(null);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      setIsLoadingEmployees(true);
      getEmployeeList()
        .then((data) => {
          if (data) {
            setEmployees(data);
            if (defaultEmployeeId && data.some(emp => emp.id === defaultEmployeeId)) {
              setSelectedEmployeeId(defaultEmployeeId);
            } else if (data.length > 0) {
              // Optionally default to the first employee if no default is provided or valid
              // setSelectedEmployeeId(data[0].id);
            }
          }
        })
        .catch(error => {
          console.error("Failed to fetch employees:", error);
          setFormState({ message: 'Failed to load employees for selection.', type: 'error' });
        })
        .finally(() => {
          setIsLoadingEmployees(false);
        });
    }
  }, [isOpen, defaultEmployeeId]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedEmployeeId) {
      setFormState({ message: 'Please select an employee.', type: 'error', errors: { general: ['Employee selection is required.'] } });
      return;
    }
    if (!noteText.trim()) {
      setFormState({ message: 'Note text cannot be empty.', type: 'error', errors: { note_text: ['Note cannot be empty.'] } });
      return;
    }

    setIsSubmitting(true);
    setFormState(null); // Clear previous messages

    const formData = new FormData();
    formData.append('note_text', noteText);
    formData.append('employee_id', selectedEmployeeId);

    const result = await addEmployeeNote(null, formData);
    setFormState(result);
    setIsSubmitting(false);

    if (result && result.type === 'success') {
      setNoteText(''); // Clear the note text
      // Optionally, keep the selected employee or reset: setSelectedEmployeeId('');
      onClose(); // CLOSE MODAL ON SUCCESS
      // Consider revalidating notes for the specific employee if displaying them elsewhere
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm">
      <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-700"
          aria-label="Close modal"
        >
          <XMarkIcon className="h-6 w-6" />
        </button>
        <h2 className="text-xl font-semibold mb-4">Add Employee Note</h2>

        {formState && formState.message && (
          <div className={`mb-4 p-3 rounded-md text-sm ${formState.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {formState.message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="employee-select" className="block text-sm font-medium text-gray-700 mb-1">
              Select Employee
            </label>
            {isLoadingEmployees ? (
              <p className="text-sm text-gray-500">Loading employees...</p>
            ) : (
              <select
                id="employee-select"
                name="employee_id"
                value={selectedEmployeeId}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
                className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                disabled={isSubmitting}
              >
                <option value="" disabled={!defaultEmployeeId}>-- Select an Employee --</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            )}
            {formState?.errors?.general && <p className="mt-1 text-xs text-red-600">{formState.errors.general}</p>}
          </div>

          <div>
            <label htmlFor="note-text" className="block text-sm font-medium text-gray-700 mb-1">
              Note
            </label>
            <textarea
              id="note-text"
              name="note_text"
              rows={4}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Enter note details..."
              disabled={isSubmitting}
            />
            {formState?.errors?.note_text && <p className="mt-1 text-xs text-red-600">{formState.errors.note_text}</p>}
          </div>

          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isSubmitting || isLoadingEmployees}>
              {isSubmitting ? 'Saving...' : 'Save Note'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
} 