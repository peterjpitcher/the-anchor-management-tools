'use client'

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { addEmployee } from '@/app/actions/employeeActions';
import { Loader2, Save } from 'lucide-react';
// New UI components
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Card } from '@/components/ui-v2/layout/Card';
import { Tabs } from '@/components/ui-v2/navigation/Tabs';
import { Button } from '@/components/ui-v2/forms/Button';
import { Input } from '@/components/ui-v2/forms/Input';
import { Select } from '@/components/ui-v2/forms/Select';
import { Textarea } from '@/components/ui-v2/forms/Textarea';
import { Checkbox } from '@/components/ui-v2/forms/Checkbox';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { toast } from '@/components/ui-v2/feedback/Toast';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav';
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
  const updateField = (field: string, value: string | boolean) => {
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
      key: 'personal',
      label: 'Personal Details',
      content: (
        <div className="p-4 sm:p-6 space-y-6 sm:space-y-4">
          <div className="grid grid-cols-1 gap-6 sm:gap-4 sm:grid-cols-2">
            <FormGroup 
              label="First Name" 
              required
            >
              <Input
                type="text"
                value={formData.first_name}
                onChange={(e) => updateField('first_name', e.target.value)}
                required
              />
            </FormGroup>
            <FormGroup 
              label="Last Name" 
              required
            >
              <Input
                type="text"
                value={formData.last_name}
                onChange={(e) => updateField('last_name', e.target.value)}
                required
              />
            </FormGroup>
            <FormGroup 
              label="Email Address" 
              required
            >
              <Input
                type="email"
                value={formData.email_address}
                onChange={(e) => updateField('email_address', e.target.value)}
                required
              />
            </FormGroup>
            <FormGroup 
              label="Job Title" 
              required
            >
              <Input
                type="text"
                value={formData.job_title}
                onChange={(e) => updateField('job_title', e.target.value)}
                required
              />
            </FormGroup>
            <FormGroup 
              label="Employment Start Date" 
              required
            >
              <Input
                type="date"
                value={formData.employment_start_date}
                onChange={(e) => updateField('employment_start_date', e.target.value)}
                required
              />
            </FormGroup>
            <FormGroup 
              label="Status" 
              required
            >
              <Select
                value={formData.status}
                onChange={(e) => updateField('status', e.target.value)}
                options={[
                  { value: 'Active', label: 'Active' },
                  { value: 'Former', label: 'Former' },
                  { value: 'Prospective', label: 'Prospective' }
                ]}
              />
            </FormGroup>
            <FormGroup label="Date of Birth">
              <Input
                type="date"
                value={formData.date_of_birth || ''}
                onChange={(e) => updateField('date_of_birth', e.target.value)}
              />
            </FormGroup>
            <FormGroup label="Phone Number">
              <Input
                type="tel"
                value={formData.phone_number || ''}
                onChange={(e) => updateField('phone_number', e.target.value)}
              />
            </FormGroup>
            <FormGroup label="Employment End Date">
              <Input
                type="date"
                value={formData.employment_end_date || ''}
                onChange={(e) => updateField('employment_end_date', e.target.value)}
              />
            </FormGroup>
            <FormGroup label="Address" className="sm:col-span-2">
              <Textarea
                value={formData.address || ''}
                onChange={(e) => updateField('address', e.target.value)}
                rows={3}
              />
            </FormGroup>
          </div>
        </div>
      )
    },
    {
      key: 'financial',
      label: 'Financial Details',
      content: (
        <div className="p-4 sm:p-6 space-y-6 sm:space-y-4">
          <div className="grid grid-cols-1 gap-6 sm:gap-4 sm:grid-cols-2">
            <FormGroup label="NI Number">
              <Input
                type="text"
                value={formData.ni_number || ''}
                onChange={(e) => updateField('ni_number', e.target.value)}
                placeholder="AA123456A"
              />
            </FormGroup>
            <FormGroup label="Payee Name">
              <Input
                type="text"
                value={formData.payee_name || ''}
                onChange={(e) => updateField('payee_name', e.target.value)}
              />
            </FormGroup>
            <FormGroup label="Bank Name">
              <Input
                type="text"
                value={formData.bank_name || ''}
                onChange={(e) => updateField('bank_name', e.target.value)}
              />
            </FormGroup>
            <FormGroup label="Sort Code">
              <Input
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
              />
            </FormGroup>
            <FormGroup label="Account Number">
              <Input
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
              />
            </FormGroup>
            <FormGroup label="Branch Address" className="sm:col-span-2">
              <Textarea
                value={formData.branch_address || ''}
                onChange={(e) => updateField('branch_address', e.target.value)}
                rows={2}
              />
            </FormGroup>
          </div>
        </div>
      )
    },
    {
      key: 'health',
      label: 'Health Records',
      content: (
        <div className="p-4 sm:p-6 space-y-6 sm:space-y-4">
          <div className="grid grid-cols-1 gap-6 sm:gap-4 sm:grid-cols-2">
            <FormGroup label="Doctor Name">
              <Input
                type="text"
                value={formData.doctor_name || ''}
                onChange={(e) => updateField('doctor_name', e.target.value)}
              />
            </FormGroup>
            <FormGroup label="Doctor Address" className="sm:col-span-2">
              <Textarea
                value={formData.doctor_address || ''}
                onChange={(e) => updateField('doctor_address', e.target.value)}
                rows={2}
              />
            </FormGroup>
            <FormGroup label="Allergies" className="sm:col-span-2">
              <Textarea
                value={formData.allergies || ''}
                onChange={(e) => updateField('allergies', e.target.value)}
                rows={2}
              />
            </FormGroup>
            <FormGroup label="History of Illness" className="sm:col-span-2">
              <Textarea
                value={formData.illness_history || ''}
                onChange={(e) => updateField('illness_history', e.target.value)}
                rows={3}
              />
            </FormGroup>
            <FormGroup label="Recent Treatment (last 3 months)" className="sm:col-span-2">
              <Textarea
                value={formData.recent_treatment || ''}
                onChange={(e) => updateField('recent_treatment', e.target.value)}
                rows={2}
              />
            </FormGroup>
            <div className="sm:col-span-2">
              <h3 className="text-base font-medium text-gray-900 mb-4 sm:mb-3">Conditions</h3>
              <div className="space-y-3 sm:space-y-2">
                <Checkbox
                  label="Suffer with Diabetes?"
                  checked={formData.has_diabetes || false}
                  onChange={(e) => updateField('has_diabetes', e.target.checked)}
                />
                <Checkbox
                  label="Suffer with Epilepsy/Fits/Blackouts?"
                  checked={formData.has_epilepsy || false}
                  onChange={(e) => updateField('has_epilepsy', e.target.checked)}
                />
                <Checkbox
                  label="Suffer with Eczema/Dermatitis/Skin Disease?"
                  checked={formData.has_skin_condition || false}
                  onChange={(e) => updateField('has_skin_condition', e.target.checked)}
                />
                <Checkbox
                  label="Suffer with Depressive Illness?"
                  checked={formData.has_depressive_illness || false}
                  onChange={(e) => updateField('has_depressive_illness', e.target.checked)}
                />
                <Checkbox
                  label="Suffer with Bowel Problems?"
                  checked={formData.has_bowel_problems || false}
                  onChange={(e) => updateField('has_bowel_problems', e.target.checked)}
                />
                <Checkbox
                  label="Suffer with Earache or Infection?"
                  checked={formData.has_ear_problems || false}
                  onChange={(e) => updateField('has_ear_problems', e.target.checked)}
                />
              </div>
            </div>
            <div className="sm:col-span-2">
              <h3 className="text-sm font-medium text-gray-700 mb-4 sm:mb-3">Disability Information</h3>
              <div className="space-y-6 sm:space-y-4">
                <Checkbox
                  label="Is Registered Disabled?"
                  checked={formData.is_registered_disabled || false}
                  onChange={(e) => updateField('is_registered_disabled', e.target.checked)}
                />
                {formData.is_registered_disabled && (
                  <>
                    <FormGroup label="Disability Registration Number">
                      <Input
                        type="text"
                        value={formData.disability_reg_number || ''}
                        onChange={(e) => updateField('disability_reg_number', e.target.value)}
                      />
                    </FormGroup>
                    <FormGroup label="Registration Expiry Date">
                      <Input
                        type="date"
                        value={formData.disability_reg_expiry_date || ''}
                        onChange={(e) => updateField('disability_reg_expiry_date', e.target.value)}
                      />
                    </FormGroup>
                    <FormGroup label="Disability Details">
                      <Textarea
                        value={formData.disability_details || ''}
                        onChange={(e) => updateField('disability_details', e.target.value)}
                        rows={3}
                      />
                    </FormGroup>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )
    }
  ];

  const navItems: HeaderNavItem[] = [
    { label: 'Personal', href: '#personal' },
    { label: 'Financial', href: '#financial' },
    { label: 'Health', href: '#health' },
  ];

  const headerActions = (
    <Button
      onClick={handleSaveAndClose}
      disabled={isLoading}
      variant="primary"
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
    </Button>
  );

  return (
    <PageLayout
      title="Add New Employee"
      subtitle="Fill in the employee information across all tabs. All data is saved when you click 'Save and Close'."
      backButton={{
        label: 'Back to Employees',
        href: '/employees'
      }}
      navItems={navItems}
      headerActions={headerActions}
    >
      <Card id="personal">
        <Tabs 
          items={tabs}
        />
      </Card>
      
      <Alert variant="info" id="health">
        <strong>Note:</strong> You can switch between tabs without losing your data. 
        All information will be saved when you click &quot;Save and Close&quot;.
      </Alert>
    </PageLayout>
  );
}
