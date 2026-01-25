'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { EmployeeEmergencyContact } from '@/types/database'
import { Button } from '@/components/ui-v2/forms/Button'
import AddEmergencyContactModal from '@/components/modals/AddEmergencyContactModal'

interface EmergencyContactsTabProps {
  employeeId: string
  contacts: EmployeeEmergencyContact[]
  canEdit: boolean
}

export default function EmergencyContactsTab({
  employeeId,
  contacts,
  canEdit
}: EmergencyContactsTabProps) {
  const router = useRouter()
  const [isModalOpen, setIsModalOpen] = useState(false)

  const handleSuccess = () => {
    setIsModalOpen(false)
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
          <Button onClick={() => setIsModalOpen(true)}>
            Add Contact
          </Button>
        )}
      </div>

      <AddEmergencyContactModal
        employeeId={employeeId}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleSuccess}
      />

      {contacts.length === 0 ? (
        <p className="text-sm text-gray-500">No emergency contacts found.</p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {contacts.map((contact) => (
            <li key={contact.id} className="py-4">
              <div className="flex space-x-3">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">{contact.name}</h3>
                    <div className="flex items-center space-x-2">
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
                      <p className="text-sm text-gray-500">{contact.relationship}</p>
                    </div>
                  </div>
                  {contact.phone_number && <p className="text-sm text-gray-500">Telephone: {contact.phone_number}</p>}
                  {contact.mobile_number && <p className="text-sm text-gray-500">Mobile: {contact.mobile_number}</p>}
                  {contact.address && <p className="text-sm text-gray-500">{contact.address}</p>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
