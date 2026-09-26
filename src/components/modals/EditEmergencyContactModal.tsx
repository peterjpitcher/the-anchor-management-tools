'use client'

import { useActionState, useEffect } from 'react'
import { updateEmergencyContact } from '@/app/actions/employeeActions'
import type { EmployeeEmergencyContact } from '@/types/database'
import { Alert, Button, Field, Input, Modal, Select, Textarea } from '@/ds'

interface EditEmergencyContactModalProps {
  contact: EmployeeEmergencyContact
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export default function EditEmergencyContactModal({
  contact,
  isOpen,
  onClose,
  onSuccess,
}: EditEmergencyContactModalProps) {
  const [state, formAction, pending] = useActionState(updateEmergencyContact, null)
  const formId = `edit-emergency-contact-${contact.id}`

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

  // The actions sit in the Modal footer; the submit button reaches the form through form=.
  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Edit Contact"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={pending}>
            Save Changes
          </Button>
        </>
      }
    >
      <form id={formId} action={formAction} className="space-y-4">
        <input type="hidden" name="contact_id" value={contact.id} />
        <input type="hidden" name="employee_id" value={contact.employee_id} />
        {formFields.map((field) => {
          const error = state?.errors?.[field.name]?.join(' ') || undefined
          return (
            <Field key={field.name} label={field.label} required={field.required}>
              {field.type === 'textarea' ? (
                <Textarea
                  id={`edit-${field.name}`}
                  name={field.name}
                  rows={3}
                  defaultValue={field.defaultValue}
                  error={error}
                />
              ) : field.type === 'select' ? (
                <Select
                  id={`edit-${field.name}`}
                  name={field.name}
                  defaultValue={field.defaultValue}
                  error={error}
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
  )
}
