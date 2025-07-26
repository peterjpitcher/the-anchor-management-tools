'use client';

import React, { useState, useEffect, FormEvent } from 'react';
import { getEmployeeList, addEmployeeNote } from '@/app/actions/employeeActions';
import type { NoteFormState } from '@/types/actions';
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal';
import { Button } from '@/components/ui-v2/forms/Button';
import { Select } from '@/components/ui-v2/forms/Select';
import { Textarea } from '@/components/ui-v2/forms/Textarea';
import { Alert } from '@/components/ui-v2/feedback/Alert';

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

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Add Employee Note"
      size="sm"
      mobileFullscreen
      footer={
        <ModalActions>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="add-note-form" loading={isSubmitting || isLoadingEmployees}>
            Save Note
          </Button>
        </ModalActions>
      }
    >
      {formState && formState.message && (
        <Alert variant={formState.type === 'success' ? 'success' : 'error'} 
          description={formState.message}
          className="mb-4"
        />
      )}

      <form id="add-note-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="employee-select" className="block text-sm font-medium text-gray-700 mb-1">
            Select Employee
          </label>
          {isLoadingEmployees ? (
            <p className="text-sm text-gray-500">Loading employees...</p>
          ) : (
            <Select
              id="employee-select"
              name="employee_id"
              value={selectedEmployeeId}
              onChange={(e) => setSelectedEmployeeId(e.target.value)}
              disabled={isSubmitting}
              placeholder="-- Select an Employee --"
              options={employees.map(emp => ({ value: emp.id, label: emp.name }))}
              error={!!formState?.errors?.general}
            />
          )}
          {formState?.errors?.general && <p className="mt-1 text-xs text-red-600">{formState.errors.general}</p>}
        </div>

        <div>
          <label htmlFor="note-text" className="block text-sm font-medium text-gray-700 mb-1">
            Note
          </label>
          <Textarea
            id="note-text"
            name="note_text"
            rows={4}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Enter note details..."
            disabled={isSubmitting}
            error={!!formState?.errors?.note_text}
          />
          {formState?.errors?.note_text && <p className="mt-1 text-xs text-red-600">{formState.errors.note_text}</p>}
        </div>
      </form>
    </Modal>
  );
} 