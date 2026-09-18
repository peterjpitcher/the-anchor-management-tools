'use client'

import { useActionState, useEffect } from 'react'
import { useFormStatus } from 'react-dom'
import { updateEmergencyContact } from '@/app/actions/employeeActions'
import type { EmployeeEmergencyContact } from '@/types/database'
import { Button, Input, Modal, Select, Textarea } from '@/ds'

interface EditEmergencyContactModalProps {
  contact: EmployeeEmergencyContact
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? 'Saving…' : 'Save Changes'}
    </Button>
  )
}

export default function EditEmergencyContactModal({
  contact,
  isOpen,
  onClose,
  onSuccess,
}: EditEmergencyContactModalProps) {
  const [state, formAction] = useActionState(updateEmergencyContact, null)

  useEffect(() => {
    if (state?.type === 'success') {
      onSuccess?.()
      onClose()
    }
  }, [state, onClose, onSuccess])

  if (!isOpen) return null

  const formFields = [
    { name: 'name', label: 'Full Name', type: 'text', required: true, defaultValue: contact.name },
    { name: 'relationship', label: 'Relationship', type: 'text', defaultValue: contact.relationship ?? '' },
    { name: 'priority', label: 'Priority', type: 'select', options: ['Primary', 'Secondary', 'Other'], defaultValue: contact.priority ?? 'Other' },
    { name: 'phone_number', label: 'Telephone', type: 'tel', defaultValue: contact.phone_number ?? '' },
    { name: 'mobile_number', label: 'Mobile', type: 'tel', defaultValue: contact.mobile_number ?? '' },
    { name: 'address', label: 'Address', type: 'textarea', defaultValue: contact.address ?? '' },
  ]

  // The actions stay inside the form rather than in the Modal footer: SubmitButton reads the
  // form's pending state, which only works for a button rendered within the form.
  return (
    <Modal open={isOpen} onClose={onClose} title="Edit Emergency Contact">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="contact_id" value={contact.id} />
        <input type="hidden" name="employee_id" value={contact.employee_id} />
        {formFields.map((field) => (
          <div key={field.name}>
            <label htmlFor={`edit-${field.name}`} className="block text-sm font-medium text-text">
              {field.label} {field.required && <span className="text-danger">*</span>}
            </label>
            <div className="mt-1">
              {field.type === 'textarea' ? (
                <Textarea
                  id={`edit-${field.name}`}
                  name={field.name}
                  rows={3}
                  defaultValue={field.defaultValue}
                />
              ) : field.type === 'select' ? (
                <Select
                  id={`edit-${field.name}`}
                  name={field.name}
                  defaultValue={field.defaultValue}
                >
                  {field.options?.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </Select>
              ) : (
                <Input
                  type={field.type}
                  id={`edit-${field.name}`}
                  name={field.name}
                  required={field.required}
                  defaultValue={field.defaultValue}
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
  )
}
