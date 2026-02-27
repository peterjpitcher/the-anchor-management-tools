'use client'

import { useActionState, useEffect } from 'react'
import { useFormStatus } from 'react-dom'
import { updateEmergencyContact } from '@/app/actions/employeeActions'
import type { EmployeeEmergencyContact } from '@/types/database'

interface EditEmergencyContactModalProps {
  contact: EmployeeEmergencyContact
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex justify-center rounded-md border border-transparent bg-green-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Save Changes'}
    </button>
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 transition-opacity">
      <div className="relative w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
        >
          <span className="sr-only">Close</span>
          &times;
        </button>
        <h3 className="text-lg font-medium leading-6 text-gray-900">Edit Emergency Contact</h3>
        <form action={formAction} className="mt-6 space-y-6">
          <input type="hidden" name="contact_id" value={contact.id} />
          <input type="hidden" name="employee_id" value={contact.employee_id} />
          {formFields.map((field) => (
            <div key={field.name}>
              <label htmlFor={`edit-${field.name}`} className="block text-sm font-medium text-gray-700">
                {field.label} {field.required && <span className="text-red-500">*</span>}
              </label>
              <div className="mt-1">
                {field.type === 'textarea' ? (
                  <textarea
                    id={`edit-${field.name}`}
                    name={field.name}
                    rows={3}
                    defaultValue={field.defaultValue}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  />
                ) : field.type === 'select' ? (
                  <select
                    id={`edit-${field.name}`}
                    name={field.name}
                    defaultValue={field.defaultValue}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  >
                    {field.options?.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type}
                    id={`edit-${field.name}`}
                    name={field.name}
                    required={field.required}
                    defaultValue={field.defaultValue}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  />
                )}
              </div>
              {state?.errors?.[field.name] && (
                <p className="mt-2 text-sm text-red-600">{state.errors[field.name]}</p>
              )}
            </div>
          ))}

          {state?.type === 'error' && !state.errors && (
            <p className="text-sm text-red-600">{state.message}</p>
          )}

          <div className="pt-4 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 bg-white py-2 px-4 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <SubmitButton />
          </div>
        </form>
      </div>
    </div>
  )
}
