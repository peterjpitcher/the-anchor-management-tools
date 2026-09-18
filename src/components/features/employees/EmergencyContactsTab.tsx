'use client'

import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import type { EmployeeEmergencyContact } from '@/types/database'
import { deleteEmergencyContact } from '@/app/actions/employeeActions'
import { Badge, Button, IconButton, Modal } from '@/ds'
import { PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
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
    <Button type="submit" variant="danger" disabled={pending}>
      {pending ? 'Deleting…' : 'Delete'}
    </Button>
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
      <IconButton
        type="button"
        size="sm"
        onClick={() => setIsOpen(true)}
        className="text-danger hover:bg-danger-soft hover:text-danger-fg"
        title="Delete contact"
        label={`Delete ${contact.name}`}
        icon={<TrashIcon className="h-4 w-4" />}
      />

      {/* A DS Modal rather than ConfirmDialog: the delete is a server-action form, and the
          buttons stay inside it so the submit button can read the form's pending state. */}
      <Modal open={isOpen} onClose={() => setIsOpen(false)} title="Delete contact" width="sm">
        <form action={formAction}>
          <input type="hidden" name="contact_id" value={contact.id} />
          <input type="hidden" name="employee_id" value={contact.employee_id} />
          <p className="text-sm text-text-muted">
            Remove <strong>{contact.name}</strong> as an emergency contact? This cannot be undone.
          </p>
          {state?.type === 'error' && (
            <p className="mt-3 text-sm text-danger-fg">{state.message}</p>
          )}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <Button type="button" variant="secondary" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <ConfirmDeleteButton />
          </div>
        </form>
      </Modal>
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
          <h3 className="text-lg font-medium text-text">Emergency Contacts</h3>
          <p className="mt-1 text-sm text-text-muted">A list of emergency contacts for this employee.</p>
        </div>
        {canEdit && (
          <Button variant="primary" onClick={() => setIsAddOpen(true)}>Add Contact</Button>
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
        <p className="text-sm text-text-muted">No emergency contacts found.</p>
      ) : (
        <ul className="divide-y divide-border">
          {contacts.map((contact) => (
            <li key={contact.id} className="py-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-medium">{contact.name}</h3>
                    {contact.priority && contact.priority !== 'Other' && (
                      <Badge tone={contact.priority === 'Primary' ? 'success' : 'info'}>
                        {contact.priority}
                      </Badge>
                    )}
                    {contact.relationship && (
                      <p className="text-sm text-text-muted">{contact.relationship}</p>
                    )}
                  </div>
                  {contact.phone_number && <p className="text-sm text-text-muted">Telephone: {contact.phone_number}</p>}
                  {contact.mobile_number && <p className="text-sm text-text-muted">Mobile: {contact.mobile_number}</p>}
                  {contact.address && <p className="text-sm text-text-muted">{contact.address}</p>}
                </div>

                {canEdit && (
                  <div className="flex items-center gap-1 ml-4 flex-shrink-0">
                    <IconButton
                      type="button"
                      size="sm"
                      onClick={() => setEditingContact(contact)}
                      className="text-text-subtle hover:text-text-muted"
                      title="Edit contact"
                      label={`Edit ${contact.name}`}
                      icon={<PencilIcon className="h-4 w-4" />}
                    />
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
