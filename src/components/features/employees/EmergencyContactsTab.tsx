'use client'

import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import type { EmployeeEmergencyContact } from '@/types/database'
import { deleteEmergencyContact } from '@/app/actions/employeeActions'
import { Button } from '@/components/ui-v2/forms/Button'
import { PencilIcon, TrashIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import AddEmergencyContactModal from '@/components/modals/AddEmergencyContactModal'
import EditEmergencyContactModal from '@/components/modals/EditEmergencyContactModal'

interface EmergencyContactsTabProps {
  employeeId: string
  contacts: EmployeeEmergencyContact[]
  canEdit: boolean
}

function ConfirmDeleteButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full justify-center rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 sm:ml-3 sm:w-auto disabled:opacity-50"
    >
      {pending ? 'Deleting…' : 'Delete'}
    </button>
  )
}

function DeleteContactButton({
  contact,
  onDeleted,
}: {
  contact: EmployeeEmergencyContact
  onDeleted: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [state, formAction] = useActionState(deleteEmergencyContact, null)

  useEffect(() => {
    if (state?.type === 'success') {
      setIsOpen(false)
      onDeleted()
    }
  }, [state, onDeleted])

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="p-1 text-red-400 hover:text-red-600"
        title="Delete contact"
      >
        <TrashIcon className="h-4 w-4" />
        <span className="sr-only">Delete {contact.name}</span>
      </button>

      {isOpen && (
        <div className="relative z-50" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
              <form
                action={formAction}
                className="relative transform overflow-hidden rounded-lg bg-white px-4 pt-5 pb-4 text-left shadow-xl sm:my-8 w-full max-w-sm sm:p-6"
              >
                <input type="hidden" name="contact_id" value={contact.id} />
                <input type="hidden" name="employee_id" value={contact.employee_id} />
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <ExclamationTriangleIcon className="h-6 w-6 text-red-600" aria-hidden="true" />
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 className="text-base font-semibold leading-6 text-gray-900">Delete contact</h3>
                    <p className="mt-2 text-sm text-gray-500">
                      Remove <strong>{contact.name}</strong> as an emergency contact? This cannot be undone.
                    </p>
                  </div>
                </div>
                {state?.type === 'error' && (
                  <p className="mt-3 text-sm text-red-600 sm:ml-14">{state.message}</p>
                )}
                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <ConfirmDeleteButton />
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default function EmergencyContactsTab({
  employeeId,
  contacts,
  canEdit,
}: EmergencyContactsTabProps) {
  const router = useRouter()
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<EmployeeEmergencyContact | null>(null)

  const handleSuccess = () => {
    setIsAddOpen(false)
    setEditingContact(null)
    router.refresh()
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Emergency Contacts</h3>
          <p className="mt-1 text-sm text-gray-600">A list of emergency contacts for this employee.</p>
        </div>
        {canEdit && (
          <Button onClick={() => setIsAddOpen(true)}>Add Contact</Button>
        )}
      </div>

      <AddEmergencyContactModal
        employeeId={employeeId}
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onSuccess={handleSuccess}
      />

      {editingContact && (
        <EditEmergencyContactModal
          contact={editingContact}
          isOpen={true}
          onClose={() => setEditingContact(null)}
          onSuccess={handleSuccess}
        />
      )}

      {contacts.length === 0 ? (
        <p className="text-sm text-gray-500">No emergency contacts found.</p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {contacts.map((contact) => (
            <li key={contact.id} className="py-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-medium">{contact.name}</h3>
                    {contact.priority && contact.priority !== 'Other' && (
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          contact.priority === 'Primary'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {contact.priority}
                      </span>
                    )}
                    {contact.relationship && (
                      <p className="text-sm text-gray-500">{contact.relationship}</p>
                    )}
                  </div>
                  {contact.phone_number && <p className="text-sm text-gray-500">Telephone: {contact.phone_number}</p>}
                  {contact.mobile_number && <p className="text-sm text-gray-500">Mobile: {contact.mobile_number}</p>}
                  {contact.address && <p className="text-sm text-gray-500">{contact.address}</p>}
                </div>

                {canEdit && (
                  <div className="flex items-center gap-1 ml-4 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditingContact(contact)}
                      className="p-1 text-gray-400 hover:text-gray-600"
                      title="Edit contact"
                    >
                      <PencilIcon className="h-4 w-4" />
                      <span className="sr-only">Edit {contact.name}</span>
                    </button>
                    <DeleteContactButton
                      contact={contact}
                      onDeleted={() => router.refresh()}
                    />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
