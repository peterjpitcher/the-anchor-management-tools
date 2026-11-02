'use client'

import { startTransition, useActionState, useEffect, useRef } from 'react'
import type { FormEvent } from 'react'
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
  // Handle each success result once: it stays in state, and new callbacks from a re-render
  // would otherwise run the effect (and the page refresh) again.
  const handledState = useRef<typeof state>(null)

  useEffect(() => {
    if (state?.type === 'success' && handledState.current !== state) {
      handledState.current = state
      onSuccess?.()
      onClose()
    }
  }, [state, onClose, onSuccess])

  if (!isOpen) return null

  // onSubmit rather than a form action, so a refused save keeps what was typed.
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(() => formAction(formData))
  }

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
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
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

        <p className="text-xs text-text-muted">A primary contact needs a telephone or mobile number.</p>

        {state?.type === 'error' && !state.errors && (
          <Alert tone="danger" size="sm">{state.message}</Alert>
        )}

      </form>
    </Modal>
  )
}
