'use client';

import { useState, useEffect, useTransition } from 'react';
import type { EmployeeEmergencyContact } from '@/types/database';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { Button } from '@/components/ui/Button';
import AddEmergencyContactModal from '@/components/modals/AddEmergencyContactModal';

interface EmergencyContactsTabProps {
  employeeId: string;
}

export default function EmergencyContactsTab({ employeeId }: EmergencyContactsTabProps) {
  const supabase = useSupabase();
  const [contacts, setContacts] = useState<EmployeeEmergencyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function getEmergencyContacts(employeeId: string): Promise<EmployeeEmergencyContact[]> {
    const { data, error } = await supabase
      .from('employee_emergency_contacts')
      .select('*')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching emergency contacts:', error);
      return [];
    }
    return data || [];
  }

  const fetchContacts = async () => {
    setLoading(true);
    const fetchedContacts = await getEmergencyContacts(employeeId);
    setContacts(fetchedContacts);
    setLoading(false);
  };

  useEffect(() => {
    fetchContacts();
  }, [employeeId]);
  
  const handleModalClose = () => {
    setIsModalOpen(false);
    // Refresh the list after the modal is closed
    startTransition(() => {
      fetchContacts();
    });
  }

  if (loading) {
    return <div>Loading emergency contacts...</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
            <h3 className="text-lg font-medium text-gray-900">Emergency Contacts</h3>
            <p className="mt-1 text-sm text-gray-600">
                A list of emergency contacts for this employee.
            </p>
        </div>
        <Button onClick={() => setIsModalOpen(true)}>
          Add Contact
        </Button>
      </div>
      
      <AddEmergencyContactModal 
        employeeId={employeeId}
        isOpen={isModalOpen}
        onClose={handleModalClose}
      />

      {contacts.length === 0 ? (
        <p>No emergency contacts found.</p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {contacts.map((contact) => (
            <li key={contact.id} className="py-4">
              <div className="flex space-x-3">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">{contact.name}</h3>
                    <p className="text-sm text-gray-500">{contact.relationship}</p>
                  </div>
                  <p className="text-sm text-gray-500">{contact.phone_number}</p>
                  <p className="text-sm text-gray-500">{contact.address}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}