'use client';

import { useActionState, useEffect } from 'react';
import { addEmergencyContact } from '@/app/actions/employeeActions';
import { Alert, Button, Field, Input, Modal, Select, Textarea } from '@/ds';

interface AddEmergencyContactModalProps {
  employeeId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function AddEmergencyContactModal({
  employeeId,
  isOpen,
  onClose,
  onSuccess,
}: AddEmergencyContactModalProps) {
  const [state, formAction, pending] = useActionState(addEmergencyContact, null);
  const formId = `add-emergency-contact-${employeeId}`;

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

  // The actions sit in the Modal footer; the submit button reaches the form through form=.
  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Add Contact"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={pending}>
            Add Contact
          </Button>
        </>
      }
    >
      <form id={formId} action={formAction} className="space-y-4">
        <input type="hidden" name="employee_id" value={employeeId} />
        {formFields.map((field) => {
          const error = state?.errors?.[field.name]?.join(' ') || undefined
          return (
            <Field key={field.name} label={field.label} required={field.required}>
              {field.type === 'textarea' ? (
                <Textarea
                  id={field.name}
                  name={field.name}
                  rows={3}
                  error={error}
                />
              ) : field.type === 'select' ? (
                <Select
                  id={field.name}
                  name={field.name}
                  defaultValue="Other"
                  error={error}
                >
                  {field.options?.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </Select>
              ) : (
                <Input
                  type={field.type}
                  id={field.name}
                  name={field.name}
                  required={field.required}
                  error={error}
                />
              )}
            </Field>
          )
        })}

        {state?.type === 'error' && !state.errors && (
          <Alert tone="danger" size="sm">{state.message}</Alert>
        )}

      </form>
    </Modal>
  );
}
