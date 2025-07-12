'use client'

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Tabs } from '@/components/ui/Tabs';
import { addEmployee } from '@/app/actions/employeeActions';
import toast from 'react-hot-toast';
import { Loader2, Save, X } from 'lucide-react';

interface EmployeeData {
  // Personal Details
  first_name: string;
  last_name: string;
  email_address: string;
  job_title: string;
  employment_start_date: string;
  status: string;
  date_of_birth?: string;
  address?: string;
  phone_number?: string;
  employment_end_date?: string;
  
  // Financial Details
  ni_number?: string;
  payee_name?: string;
  bank_name?: string;
  bank_sort_code?: string;
  bank_account_number?: string;
  branch_address?: string;
  
  // Health Records
  gp_name?: string;
  gp_practice?: string;
  gp_address?: string;
  gp_phone?: string;
  medical_conditions?: string;
  medications?: string;
  allergies?: string;
  emergency_medical_info?: string;
  blood_type?: string;
  
  // Emergency Contacts (array)
  emergency_contacts: Array<{
    name: string;
    relationship: string;
    phone_number: string;
    email?: string;
    is_primary: boolean;
  }>;
  
  // Right to Work
  has_right_to_work?: boolean;
  right_to_work_type?: string;
  right_to_work_expiry?: string;
  right_to_work_notes?: string;
  
  // Onboarding
  onboarding_tasks: Array<{
    task: string;
    completed: boolean;
    due_date?: string;
  }>;
}

export default function NewEmployeePage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  
  // Initialize form data with default values
  const [formData, setFormData] = useState<EmployeeData>({
    first_name: '',
    last_name: '',
    email_address: '',
    job_title: '',
    employment_start_date: '',
    status: 'Active',
    emergency_contacts: [],
    onboarding_tasks: []
  });

  // Update form field
  const updateField = (field: string, value: string | boolean | any[]) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // Handle final save - create employee with all data
  const handleSaveAndClose = async () => {
    // Validate required fields
    if (!formData.first_name || !formData.last_name || !formData.email_address || 
        !formData.job_title || !formData.employment_start_date) {
      toast.error('Please fill in all required personal details');
      setActiveTab(0);
      return;
    }

    setIsLoading(true);
    
    try {
      // Create FormData for employee
      const employeeFormData = new FormData();
      employeeFormData.append('first_name', formData.first_name);
      employeeFormData.append('last_name', formData.last_name);
      employeeFormData.append('email_address', formData.email_address);
      employeeFormData.append('job_title', formData.job_title);
      employeeFormData.append('employment_start_date', formData.employment_start_date);
      employeeFormData.append('status', formData.status);
      
      if (formData.date_of_birth) employeeFormData.append('date_of_birth', formData.date_of_birth);
      if (formData.address) employeeFormData.append('address', formData.address);
      if (formData.phone_number) employeeFormData.append('phone_number', formData.phone_number);
      if (formData.employment_end_date) employeeFormData.append('employment_end_date', formData.employment_end_date);

      // Add financial details to the employee creation
      if (formData.ni_number) employeeFormData.append('ni_number', formData.ni_number);
      if (formData.payee_name) employeeFormData.append('payee_name', formData.payee_name);
      if (formData.bank_name) employeeFormData.append('bank_name', formData.bank_name);
      if (formData.bank_sort_code) employeeFormData.append('bank_sort_code', formData.bank_sort_code);
      if (formData.bank_account_number) employeeFormData.append('bank_account_number', formData.bank_account_number);
      if (formData.branch_address) employeeFormData.append('branch_address', formData.branch_address);

      // Add health records
      if (formData.gp_name) employeeFormData.append('gp_name', formData.gp_name);
      if (formData.gp_practice) employeeFormData.append('gp_practice', formData.gp_practice);
      if (formData.gp_address) employeeFormData.append('gp_address', formData.gp_address);
      if (formData.gp_phone) employeeFormData.append('gp_phone', formData.gp_phone);
      if (formData.medical_conditions) employeeFormData.append('medical_conditions', formData.medical_conditions);
      if (formData.medications) employeeFormData.append('medications', formData.medications);
      if (formData.allergies) employeeFormData.append('allergies', formData.allergies);
      if (formData.emergency_medical_info) employeeFormData.append('emergency_medical_info', formData.emergency_medical_info);
      if (formData.blood_type) employeeFormData.append('blood_type', formData.blood_type);

      // Add other data as JSON
      employeeFormData.append('emergency_contacts', JSON.stringify(formData.emergency_contacts));
      employeeFormData.append('right_to_work', JSON.stringify({
        has_right_to_work: formData.has_right_to_work,
        right_to_work_type: formData.right_to_work_type,
        right_to_work_expiry: formData.right_to_work_expiry,
        right_to_work_notes: formData.right_to_work_notes
      }));
      employeeFormData.append('onboarding_tasks', JSON.stringify(formData.onboarding_tasks));

      // Create the employee
      const result = await addEmployee(null, employeeFormData);
      
      if (!result || result.type !== 'success') {
        throw new Error(result?.message || 'Failed to create employee');
      }

      toast.success('Employee created successfully!');
      router.push('/employees');
      
    } catch (error) {
      console.error('Error saving employee:', error);
      toast.error('Failed to save employee. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const tabs = [
    {
      label: 'Personal Details',
      content: (
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                First Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.first_name}
                onChange={(e) => updateField('first_name', e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Last Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.last_name}
                onChange={(e) => updateField('last_name', e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Email Address <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                value={formData.email_address}
                onChange={(e) => updateField('email_address', e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Job Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.job_title}
                onChange={(e) => updateField('job_title', e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Employment Start Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={formData.employment_start_date}
                onChange={(e) => updateField('employment_start_date', e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Status <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.status}
                onChange={(e) => updateField('status', e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              >
                <option value="Active">Active</option>
                <option value="Former">Former</option>
                <option value="Prospective">Prospective</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Date of Birth
              </label>
              <input
                type="date"
                value={formData.date_of_birth || ''}
                onChange={(e) => updateField('date_of_birth', e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Phone Number
              </label>
              <input
                type="tel"
                value={formData.phone_number || ''}
                onChange={(e) => updateField('phone_number', e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700">
                Address
              </label>
              <textarea
                value={formData.address || ''}
                onChange={(e) => updateField('address', e.target.value)}
                rows={3}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>
        </div>
      )
    },
    {
      label: 'Financial Details',
      content: (
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                NI Number
              </label>
              <input
                type="text"
                value={formData.ni_number || ''}
                onChange={(e) => updateField('ni_number', e.target.value)}
                placeholder="AA123456A"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Payee Name
              </label>
              <input
                type="text"
                value={formData.payee_name || ''}
                onChange={(e) => updateField('payee_name', e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Bank Name
              </label>
              <input
                type="text"
                value={formData.bank_name || ''}
                onChange={(e) => updateField('bank_name', e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Sort Code
              </label>
              <input
                type="text"
                value={formData.bank_sort_code || ''}
                onChange={(e) => {
                  // Auto-format sort code as user types
                  const value = e.target.value.replace(/\D/g, '');
                  if (value.length <= 6) {
                    const formatted = value.match(/.{1,2}/g)?.join('-') || value;
                    updateField('bank_sort_code', formatted);
                  }
                }}
                placeholder="00-00-00"
                maxLength={8}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Account Number
              </label>
              <input
                type="text"
                value={formData.bank_account_number || ''}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '');
                  if (value.length <= 8) {
                    updateField('bank_account_number', value);
                  }
                }}
                placeholder="8 digits"
                maxLength={8}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700">
                Branch Address
              </label>
              <textarea
                value={formData.branch_address || ''}
                onChange={(e) => updateField('branch_address', e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>
        </div>
      )
    },
    {
      label: 'Health Records',
      content: (
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                GP Name
              </label>
              <input
                type="text"
                value={formData.gp_name || ''}
                onChange={(e) => updateField('gp_name', e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                GP Practice
              </label>
              <input
                type="text"
                value={formData.gp_practice || ''}
                onChange={(e) => updateField('gp_practice', e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                GP Phone
              </label>
              <input
                type="tel"
                value={formData.gp_phone || ''}
                onChange={(e) => updateField('gp_phone', e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Blood Type
              </label>
              <select
                value={formData.blood_type || ''}
                onChange={(e) => updateField('blood_type', e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              >
                <option value="">Select blood type</option>
                <option value="A+">A+</option>
                <option value="A-">A-</option>
                <option value="B+">B+</option>
                <option value="B-">B-</option>
                <option value="AB+">AB+</option>
                <option value="AB-">AB-</option>
                <option value="O+">O+</option>
                <option value="O-">O-</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700">
                GP Address
              </label>
              <textarea
                value={formData.gp_address || ''}
                onChange={(e) => updateField('gp_address', e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700">
                Medical Conditions
              </label>
              <textarea
                value={formData.medical_conditions || ''}
                onChange={(e) => updateField('medical_conditions', e.target.value)}
                rows={3}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700">
                Medications
              </label>
              <textarea
                value={formData.medications || ''}
                onChange={(e) => updateField('medications', e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700">
                Allergies
              </label>
              <textarea
                value={formData.allergies || ''}
                onChange={(e) => updateField('allergies', e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>
        </div>
      )
    },
    {
      label: 'Emergency Contacts',
      content: (
        <div className="p-6">
          <div className="mb-4">
            <button
              type="button"
              onClick={() => {
                setFormData(prev => ({
                  ...prev,
                  emergency_contacts: [
                    ...prev.emergency_contacts,
                    { name: '', relationship: '', phone_number: '', email: '', is_primary: prev.emergency_contacts.length === 0 }
                  ]
                }));
              }}
              className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
            >
              Add Emergency Contact
            </button>
          </div>
          
          <div className="space-y-4">
            {formData.emergency_contacts.map((contact, index) => (
              <div key={index} className="border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-start mb-4">
                  <h4 className="text-sm font-medium text-gray-900">
                    Emergency Contact {index + 1}
                    {contact.is_primary && <span className="ml-2 text-green-600">(Primary)</span>}
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      setFormData(prev => ({
                        ...prev,
                        emergency_contacts: prev.emergency_contacts.filter((_, i) => i !== index)
                      }));
                    }}
                    className="text-red-600 hover:text-red-900"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={contact.name}
                      onChange={(e) => {
                        const newContacts = [...formData.emergency_contacts];
                        newContacts[index].name = e.target.value;
                        updateField('emergency_contacts', newContacts);
                      }}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Relationship <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={contact.relationship}
                      onChange={(e) => {
                        const newContacts = [...formData.emergency_contacts];
                        newContacts[index].relationship = e.target.value;
                        updateField('emergency_contacts', newContacts);
                      }}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Phone Number <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="tel"
                      value={contact.phone_number}
                      onChange={(e) => {
                        const newContacts = [...formData.emergency_contacts];
                        newContacts[index].phone_number = e.target.value;
                        updateField('emergency_contacts', newContacts);
                      }}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Email
                    </label>
                    <input
                      type="email"
                      value={contact.email || ''}
                      onChange={(e) => {
                        const newContacts = [...formData.emergency_contacts];
                        newContacts[index].email = e.target.value;
                        updateField('emergency_contacts', newContacts);
                      }}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={contact.is_primary}
                        onChange={(e) => {
                          const newContacts = [...formData.emergency_contacts];
                          // If checking this one, uncheck all others
                          if (e.target.checked) {
                            newContacts.forEach((c, i) => {
                              c.is_primary = i === index;
                            });
                          } else {
                            newContacts[index].is_primary = false;
                          }
                          updateField('emergency_contacts', newContacts);
                        }}
                        className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                      />
                      <span className="ml-2 text-sm text-gray-700">Primary Contact</span>
                    </label>
                  </div>
                </div>
              </div>
            ))}
            
            {formData.emergency_contacts.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">
                No emergency contacts added yet. Click &quot;Add Emergency Contact&quot; to add one.
              </p>
            )}
          </div>
        </div>
      )
    },
    {
      label: 'Right to Work',
      content: (
        <div className="p-6 space-y-4">
          <div className="space-y-4">
            <div>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.has_right_to_work || false}
                  onChange={(e) => updateField('has_right_to_work', e.target.checked)}
                  className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                />
                <span className="ml-2 text-sm font-medium text-gray-700">Has Right to Work in UK</span>
              </label>
            </div>
            
            {formData.has_right_to_work && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Document Type
                  </label>
                  <select
                    value={formData.right_to_work_type || ''}
                    onChange={(e) => updateField('right_to_work_type', e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                  >
                    <option value="">Select document type</option>
                    <option value="passport">British Passport</option>
                    <option value="birth_certificate">Birth Certificate</option>
                    <option value="visa">Visa</option>
                    <option value="brp">Biometric Residence Permit</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Expiry Date (if applicable)
                  </label>
                  <input
                    type="date"
                    value={formData.right_to_work_expiry || ''}
                    onChange={(e) => updateField('right_to_work_expiry', e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Notes
                  </label>
                  <textarea
                    value={formData.right_to_work_notes || ''}
                    onChange={(e) => updateField('right_to_work_notes', e.target.value)}
                    rows={3}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )
    },
    {
      label: 'Onboarding',
      content: (
        <div className="p-6">
          <div className="mb-4">
            <button
              type="button"
              onClick={() => {
                setFormData(prev => ({
                  ...prev,
                  onboarding_tasks: [
                    ...prev.onboarding_tasks,
                    { task: '', completed: false, due_date: '' }
                  ]
                }));
              }}
              className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
            >
              Add Onboarding Task
            </button>
          </div>
          
          <div className="space-y-4">
            {formData.onboarding_tasks.map((task, index) => (
              <div key={index} className="flex items-start space-x-3">
                <input
                  type="checkbox"
                  checked={task.completed}
                  onChange={(e) => {
                    const newTasks = [...formData.onboarding_tasks];
                    newTasks[index].completed = e.target.checked;
                    updateField('onboarding_tasks', newTasks);
                  }}
                  className="mt-1 rounded border-gray-300 text-green-600 focus:ring-green-500"
                />
                <div className="flex-1">
                  <input
                    type="text"
                    value={task.task}
                    onChange={(e) => {
                      const newTasks = [...formData.onboarding_tasks];
                      newTasks[index].task = e.target.value;
                      updateField('onboarding_tasks', newTasks);
                    }}
                    placeholder="Task description"
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                  />
                </div>
                <input
                  type="date"
                  value={task.due_date || ''}
                  onChange={(e) => {
                    const newTasks = [...formData.onboarding_tasks];
                    newTasks[index].due_date = e.target.value;
                    updateField('onboarding_tasks', newTasks);
                  }}
                  className="block w-32 rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                />
                <button
                  type="button"
                  onClick={() => {
                    setFormData(prev => ({
                      ...prev,
                      onboarding_tasks: prev.onboarding_tasks.filter((_, i) => i !== index)
                    }));
                  }}
                  className="text-red-600 hover:text-red-900"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            ))}
            
            {formData.onboarding_tasks.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">
                No onboarding tasks added yet. Click &quot;Add Onboarding Task&quot; to add one.
              </p>
            )}
          </div>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex flex-col space-y-4 sm:flex-row sm:space-y-0 sm:justify-between sm:items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Add New Employee</h1>
              <p className="mt-1 text-sm text-gray-500">
                Fill in the employee information across all tabs. All data is saved when you click &quot;Save and Close&quot;.
              </p>
            </div>
            <div className="flex-shrink-0 flex space-x-2">
              <button
                onClick={handleSaveAndClose}
                disabled={isLoading}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="-ml-1 mr-2 h-4 w-4" />
                    Save and Close
                  </>
                )}
              </button>
              <Link
                href="/employees"
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              >
                <X className="-ml-1 mr-2 h-4 w-4" />
                Cancel
              </Link>
            </div>
          </div>
        </div>
      </div>
      
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <Tabs 
          tabs={tabs} 
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>
      
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-800">
          <strong>Note:</strong> You can switch between tabs without losing your data. 
          All information will be saved when you click &quot;Save and Close&quot;.
        </p>
      </div>
    </div>
  );
}