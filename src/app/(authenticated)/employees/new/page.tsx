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
  doctor_name?: string;
  doctor_address?: string;
  allergies?: string;
  illness_history?: string;
  recent_treatment?: string;
  has_diabetes?: boolean;
  has_epilepsy?: boolean;
  has_skin_condition?: boolean;
  has_depressive_illness?: boolean;
  has_bowel_problems?: boolean;
  has_ear_problems?: boolean;
  is_registered_disabled?: boolean;
  disability_reg_number?: string;
  disability_reg_expiry_date?: string;
  disability_details?: string;
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
    status: 'Active'
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
      if (formData.doctor_name) employeeFormData.append('doctor_name', formData.doctor_name);
      if (formData.doctor_address) employeeFormData.append('doctor_address', formData.doctor_address);
      if (formData.allergies) employeeFormData.append('allergies', formData.allergies);
      if (formData.illness_history) employeeFormData.append('illness_history', formData.illness_history);
      if (formData.recent_treatment) employeeFormData.append('recent_treatment', formData.recent_treatment);
      if (formData.has_diabetes !== undefined) employeeFormData.append('has_diabetes', String(formData.has_diabetes));
      if (formData.has_epilepsy !== undefined) employeeFormData.append('has_epilepsy', String(formData.has_epilepsy));
      if (formData.has_skin_condition !== undefined) employeeFormData.append('has_skin_condition', String(formData.has_skin_condition));
      if (formData.has_depressive_illness !== undefined) employeeFormData.append('has_depressive_illness', String(formData.has_depressive_illness));
      if (formData.has_bowel_problems !== undefined) employeeFormData.append('has_bowel_problems', String(formData.has_bowel_problems));
      if (formData.has_ear_problems !== undefined) employeeFormData.append('has_ear_problems', String(formData.has_ear_problems));
      if (formData.is_registered_disabled !== undefined) employeeFormData.append('is_registered_disabled', String(formData.is_registered_disabled));
      if (formData.disability_reg_number) employeeFormData.append('disability_reg_number', formData.disability_reg_number);
      if (formData.disability_reg_expiry_date) employeeFormData.append('disability_reg_expiry_date', formData.disability_reg_expiry_date);
      if (formData.disability_details) employeeFormData.append('disability_details', formData.disability_details);


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
        <div className="p-4 sm:p-6 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                First Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.first_name}
                onChange={(e) => updateField('first_name', e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
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
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
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
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
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
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
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
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
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
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
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
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
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
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Employment End Date
              </label>
              <input
                type="date"
                value={formData.employment_end_date || ''}
                onChange={(e) => updateField('employment_end_date', e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
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
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
              />
            </div>
          </div>
        </div>
      )
    },
    {
      label: 'Financial Details',
      content: (
        <div className="p-4 sm:p-6 space-y-4">
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
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
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
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
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
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
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
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
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
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
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
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
              />
            </div>
          </div>
        </div>
      )
    },
    {
      label: 'Health Records',
      content: (
        <div className="p-4 sm:p-6 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Doctor Name
              </label>
              <input
                type="text"
                value={formData.doctor_name || ''}
                onChange={(e) => updateField('doctor_name', e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700">
                Doctor Address
              </label>
              <textarea
                value={formData.doctor_address || ''}
                onChange={(e) => updateField('doctor_address', e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
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
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700">
                History of Illness
              </label>
              <textarea
                value={formData.illness_history || ''}
                onChange={(e) => updateField('illness_history', e.target.value)}
                rows={3}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700">
                Recent Treatment (last 3 months)
              </label>
              <textarea
                value={formData.recent_treatment || ''}
                onChange={(e) => updateField('recent_treatment', e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
              />
            </div>
            <div className="sm:col-span-2">
              <h3 className="text-base font-medium text-gray-900 mb-3">Conditions</h3>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.has_diabetes || false}
                    onChange={(e) => updateField('has_diabetes', e.target.checked)}
                    className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <span className="ml-2 text-sm text-gray-700">Suffer with Diabetes?</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.has_epilepsy || false}
                    onChange={(e) => updateField('has_epilepsy', e.target.checked)}
                    className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <span className="ml-2 text-sm text-gray-700">Suffer with Epilepsy/Fits/Blackouts?</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.has_skin_condition || false}
                    onChange={(e) => updateField('has_skin_condition', e.target.checked)}
                    className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <span className="ml-2 text-sm text-gray-700">Suffer with Eczema/Dermatitis/Skin Disease?</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.has_depressive_illness || false}
                    onChange={(e) => updateField('has_depressive_illness', e.target.checked)}
                    className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <span className="ml-2 text-sm text-gray-700">Suffer with Depressive Illness?</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.has_bowel_problems || false}
                    onChange={(e) => updateField('has_bowel_problems', e.target.checked)}
                    className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <span className="ml-2 text-sm text-gray-700">Suffer with Bowel Problems?</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.has_ear_problems || false}
                    onChange={(e) => updateField('has_ear_problems', e.target.checked)}
                    className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <span className="ml-2 text-sm text-gray-700">Suffer with Earache or Infection?</span>
                </label>
              </div>
            </div>
            <div className="sm:col-span-2">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Disability Information</h3>
              <div className="space-y-4">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.is_registered_disabled || false}
                    onChange={(e) => updateField('is_registered_disabled', e.target.checked)}
                    className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <span className="ml-2 text-sm text-gray-700">Is Registered Disabled?</span>
                </label>
                {formData.is_registered_disabled && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Disability Registration Number
                      </label>
                      <input
                        type="text"
                        value={formData.disability_reg_number || ''}
                        onChange={(e) => updateField('disability_reg_number', e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Registration Expiry Date
                      </label>
                      <input
                        type="date"
                        value={formData.disability_reg_expiry_date || ''}
                        onChange={(e) => updateField('disability_reg_expiry_date', e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Disability Details
                      </label>
                      <textarea
                        value={formData.disability_details || ''}
                        onChange={(e) => updateField('disability_details', e.target.value)}
                        rows={3}
                        className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
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
            <div className="flex-shrink-0 flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <button
                onClick={handleSaveAndClose}
                disabled={isLoading}
                className="inline-flex items-center justify-center px-4 py-3 sm:py-2 border border-transparent rounded-lg shadow-sm text-base sm:text-sm font-medium text-white bg-green-600 hover:bg-green-700 active:bg-green-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] transition-colors touch-manipulation"
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
                className="inline-flex items-center justify-center px-4 py-3 sm:py-2 border border-gray-300 rounded-lg shadow-sm text-base sm:text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 active:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 min-h-[44px] transition-colors touch-manipulation"
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