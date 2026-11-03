'use client'

import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { EmployeeEmergencyContact } from '@/types/database'
import { deleteEmergencyContact } from '@/app/actions/employeeActions'
import { Alert, Badge, Button, Card, CardBody, CardHeader, Empty, Icon, IconButton, Modal, SubHeading } from '@/ds'
import { contactPriorityTone } from '@/app/(authenticated)/employees/_shared/status-ui'
import AddEmergencyContactModal from '@/components/modals/AddEmergencyContactModal'
import EditEmergencyContactModal from '@/components/modals/EditEmergencyContactModal'

interface EmergencyContactsTabProps {
  employeeId: string
  contacts: EmployeeEmergencyContact[]
  canEdit: boolean
}

function DeleteContactButton({
  contact,
  onDeleted,
}: {
  contact: EmployeeEmergencyContact
  onDeleted: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [state, formAction, pending] = useActionState(deleteEmergencyContact, null)
  const formId = `delete-emergency-contact-${contact.id}`
  // Handle each success result once, so a re-render cannot run the refresh again.
  const handledState = useRef<typeof state>(null)

  useEffect(() => {
    if (state?.type === 'success' && handledState.current !== state) {
      handledState.current = state
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
        icon={<Icon name="trash" size={16} />}
      />

      {/* A DS Modal rather than ConfirmDialog: the delete is a server-action form. Its footer
          mirrors ConfirmDialog, and the submit button reaches the form through form=. */}
      <Modal
        open={isOpen}
        onClose={() => setIsOpen(false)}
        title="Delete Contact"
        width="sm"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="danger" loading={pending}>
              Delete
            </Button>
          </>
        }
      >
        <form id={formId} action={formAction} className="space-y-4">
          <input type="hidden" name="contact_id" value={contact.id} />
          <input type="hidden" name="employee_id" value={contact.employee_id} />
          <p className="text-sm text-text-muted">
            Remove <strong>{contact.name}</strong> as an emergency contact? This cannot be undone.
          </p>
          {state?.type === 'error' && (
            <Alert tone="danger" size="sm">{state.message}</Alert>
          )}
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

  // Stable callbacks: the modals run their success effect when these change, and an inline
  // function changed on every render, so each refresh started the next one.
  const handleSuccess = useCallback(() => {
    setIsAddOpen(false)
    setEditingContact(null)
    router.refresh()
  }, [router])
  const closeAdd = useCallback(() => setIsAddOpen(false), [])
  const closeEdit = useCallback(() => setEditingContact(null), [])
  const refresh = useCallback(() => router.refresh(), [router])

  return (
    <Card>
      <CardHeader
        title="Emergency Contacts"
        subtitle="A list of emergency contacts for this employee"
        action={canEdit ? (
          <Button variant="primary" size="sm" onClick={() => setIsAddOpen(true)}>Add Contact</Button>
        ) : undefined}
      />

      {/* Mounted only while open, so each opening starts with a fresh form and no old result. */}
      {isAddOpen && (
        <AddEmergencyContactModal
          employeeId={employeeId}
          isOpen={true}
          onClose={closeAdd}
          onSuccess={handleSuccess}
        />
      )}

      {editingContact && (
        <EditEmergencyContactModal
          key={editingContact.id}
          contact={editingContact}
          isOpen={true}
          onClose={closeEdit}
          onSuccess={handleSuccess}
        />
      )}

      <CardBody>
        {contacts.length === 0 ? (
          <Empty size="sm" title="No emergency contacts yet" />
        ) : (
          <ul className="-my-4 divide-y divide-border">
            {contacts.map((contact) => (
              <li key={contact.id} className="py-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Each contact is headed by its name, under the card's title. */}
                      <SubHeading>{contact.name}</SubHeading>
                      {contact.priority && contact.priority !== 'Other' && (
                        <Badge tone={contactPriorityTone(contact.priority)}>
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
                        className="text-text-muted hover:text-text"
                        title="Edit contact"
                        label={`Edit ${contact.name}`}
                        icon={<Icon name="edit" size={16} />}
                      />
                      <DeleteContactButton
                        contact={contact}
                        onDeleted={refresh}
                      />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
