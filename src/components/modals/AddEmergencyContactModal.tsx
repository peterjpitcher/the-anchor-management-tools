'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { addEmergencyContact } from '@/app/actions/employeeActions';
import { Button, Input, Modal, Select, Textarea } from '@/ds';

interface AddEmergencyContactModalProps {
  employeeId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? 'Adding...' : 'Add Contact'}
    </Button>
  );
}

export default function AddEmergencyContactModal({
  employeeId,
  isOpen,
  onClose,
  onSuccess,
}: AddEmergencyContactModalProps) {
  const [state, formAction] = useActionState(addEmergencyContact, null);

  useEffect(() => {
    if (state?.type === 'success') {
      onSuccess?.();
      onClose();
    }
  }, [state, onClose, onSuccess]);

  if (!isOpen) {
    return null;
  }

  const formFields = [
    { name: 'name', label: 'Full Name', type: 'text', required: true },
    { name: 'relationship', label: 'Relationship', type: 'text' },
    { name: 'priority', label: 'Priority', type: 'select', options: ['Primary', 'Secondary', 'Other'] },
    { name: 'phone_number', label: 'Telephone', type: 'tel' },
    { name: 'mobile_number', label: 'Mobile', type: 'tel' },
    { name: 'address', label: 'Address', type: 'textarea' },
  ];

  // The actions stay inside the form rather than in the Modal footer: SubmitButton reads the
  // form's pending state, which only works for a button rendered within the form.
  return (
    <Modal open={isOpen} onClose={onClose} title="Add New Emergency Contact">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="employee_id" value={employeeId} />
        {formFields.map((field) => (
          <div key={field.name}>
            <label htmlFor={field.name} className="block text-sm font-medium text-text">
              {field.label} {field.required && <span className="text-danger">*</span>}
            </label>
            <div className="mt-1">
              {field.type === 'textarea' ? (
                <Textarea id={field.name} name={field.name} rows={3} />
              ) : field.type === 'select' ? (
                <Select id={field.name} name={field.name} defaultValue="Other">
                  {field.options?.map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </Select>
              ) : (
                <Input
                  type={field.type}
                  name={field.name}
                  id={field.name}
                  required={field.required}
                />
              )}
            </div>
            {state?.errors?.[field.name] && (
              <p className="mt-2 text-sm text-danger">{state.errors[field.name]}</p>
            )}
          </div>
        ))}

        {state?.type === 'error' && !state.errors && (
          <p className="text-sm text-danger">{state.message}</p>
        )}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end sm:gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton />
        </div>
      </form>
    </Modal>
  );
}
