'use client'

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Employee, EmployeeAttachment, EmployeeFinancialDetails, EmployeeHealthRecord } from '@/types/database';
import { PencilSquareIcon } from '@heroicons/react/24/outline';
import DeleteEmployeeButton from '@/components/DeleteEmployeeButton';
import EmployeeNotesList from '@/components/EmployeeNotesList';
import AddEmployeeNoteForm from '@/components/AddEmployeeNoteForm';
import EmployeeAttachmentsList from '@/components/EmployeeAttachmentsList';
import AddEmployeeAttachmentForm from '@/components/AddEmployeeAttachmentForm';
import { Suspense, use, useState, useEffect, useCallback } from 'react';
import { Tabs } from '@/components/ui/Tabs';
import EmergencyContactsTab from '@/components/EmergencyContactsTab';
import FinancialDetailsTab from '@/components/FinancialDetailsTab';
import HealthRecordsTab from '@/components/HealthRecordsTab';
import RightToWorkTab from '@/components/RightToWorkTab';
import OnboardingChecklistTab from '@/components/OnboardingChecklistTab';
import { formatDate } from '@/lib/dateUtils';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { EmployeeAuditTrail } from '@/components/EmployeeAuditTrail';
import { EmployeeRecentChanges } from '@/components/EmployeeRecentChanges';

export const dynamic = 'force-dynamic';

export default function EmployeeDetailPage({ params: paramsPromise }: { params: Promise<{ employee_id: string }> }) {
  const params = use(paramsPromise);
  const supabase = useSupabase();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [attachments, setAttachments] = useState<EmployeeAttachment[] | null>(null);
  const [attachmentCategoriesMap, setAttachmentCategoriesMap] = useState<Map<string, string>>(new Map());
  const [financialDetails, setFinancialDetails] = useState<EmployeeFinancialDetails | null>(null);
  const [healthRecord, setHealthRecord] = useState<EmployeeHealthRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);


  const loadData = useCallback(async () => {
    if (!params.employee_id) {
        return notFound();
    }
    try {
        setIsLoading(true);
        
        // Define functions inline to avoid dependency issues
        const getEmployee = async (id: string): Promise<Employee | null> => {
          const { data, error } = await supabase
            .from('employees')
            .select('*')
            .eq('employee_id', id)
            .maybeSingle();

          if (error) {
            console.error('Error fetching employee:', error);
            return null;
          }
          return data;
        };

        const getEmployeeAttachments = async (employeeId: string): Promise<EmployeeAttachment[] | null> => {
          const { data, error } = await supabase
            .from('employee_attachments')
            .select('*')
            .eq('employee_id', employeeId)
            .order('uploaded_at', { ascending: false });
          if (error) {
            console.error('Error fetching employee attachments:', error);
            return null;
          }
          return data;
        };

        const getFinancialDetails = async (employeeId: string): Promise<EmployeeFinancialDetails | null> => {
          const { data, error } = await supabase
            .from('employee_financial_details')
            .select('*')
            .eq('employee_id', employeeId)
            .maybeSingle();
          if (error) { 
            console.error('Error fetching financial details:', error);
          }
          return data;
        };

        const getHealthRecord = async (employeeId: string): Promise<EmployeeHealthRecord | null> => {
          const { data, error } = await supabase
            .from('employee_health_records')
            .select('*')
            .eq('employee_id', employeeId)
            .maybeSingle();
          if (error) { 
            console.error('Error fetching health record:', error);
          }
          return data;
        };

        const getAttachmentCategories = async (): Promise<Map<string, string>> => {
          const { data, error } = await supabase.from('attachment_categories').select('category_id, category_name');
          const map = new Map<string, string>();
          if (error) {
            console.error('Error fetching attachment categories:', error);
            return map;
          }
          data?.forEach(cat => map.set(cat.category_id, cat.category_name));
          return map;
        };
        
        const [emp, att, catMap, fin, health] = await Promise.all([
            getEmployee(params.employee_id),
            getEmployeeAttachments(params.employee_id),
            getAttachmentCategories(),
            getFinancialDetails(params.employee_id),
            getHealthRecord(params.employee_id),
        ]);

        if (!emp) {
            return notFound();
        }

        setEmployee(emp);
        setAttachments(att);
        setAttachmentCategoriesMap(catMap);
        setFinancialDetails(fin);
        setHealthRecord(health);

    } catch (error) {
        console.error("Failed to load employee data", error);
    } finally {
        setIsLoading(false);
    }
  }, [params.employee_id, supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);


  if (isLoading) {
    return <div className="text-center p-6">Loading employee details...</div>;
  }

  if (!employee) {
    return notFound();
  }

  const displayFields = [
    { label: 'Full Name', value: `${employee.first_name} ${employee.last_name}` },
    { label: 'Email Address', value: employee.email_address, isEmail: true },
    { label: 'Job Title', value: employee.job_title },
    { label: 'Employment Status', value: employee.status, isBadge: true },
    { label: 'Start Date', value: employee.employment_start_date ? formatDate(employee.employment_start_date) : 'N/A' },
    { label: 'End Date', value: employee.employment_end_date ? formatDate(employee.employment_end_date) : 'N/A' },
    { label: 'Date of Birth', value: employee.date_of_birth ? formatDate(employee.date_of_birth) : 'N/A' },
    { label: 'Phone Number', value: employee.phone_number || 'N/A', isPhone: true },
    { label: 'Address', value: employee.address || 'N/A', isFullWidth: true },
  ];

  const tabs = [
    {
      label: 'Details',
      content: (
        <dl className="divide-y divide-gray-200">
          {displayFields.map((field, index) => (
            <div
              key={index}
              className={`py-3 flex flex-col sm:grid sm:grid-cols-4 sm:gap-4 ${field.isFullWidth ? 'sm:grid-cols-1' : ''}`}
            >
              <dt className="text-sm font-medium text-gray-500 mb-1 sm:mb-0">{field.label}</dt>
              <dd className={`text-sm text-gray-900 ${field.isFullWidth ? '' : 'sm:col-span-3'}`}>
                {field.isBadge ? (
                    <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium 
                        ${employee.status === 'Active' ? 'bg-green-100 text-green-800' : 
                          employee.status === 'Prospective' ? 'bg-blue-100 text-blue-800' : 
                          'bg-red-100 text-red-800'}`}
                    >
                        {field.value}
                    </span>
                ) : field.isEmail ? (
                    <a href={`mailto:${field.value}`} className="text-blue-600 hover:text-blue-900 break-all">{field.value}</a>
                ) : field.isPhone ? (
                    <a href={`tel:${field.value}`} className="text-blue-600 hover:text-blue-900">{field.value}</a>
                ) : field.isFullWidth ? (
                    <span className="break-words">{field.value}</span>
                ) : (
                    field.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )
    },
    {
      label: 'Emergency Contacts',
      content: <EmergencyContactsTab employeeId={employee.employee_id} />
    },
    {
      label: 'Financial Details',
      content: <FinancialDetailsTab financialDetails={financialDetails} />
    },
    {
      label: 'Health Records',
      content: <HealthRecordsTab healthRecord={healthRecord} />
    },
    {
      label: 'Right to Work',
      content: <RightToWorkTab employeeId={employee.employee_id} />
    },
    {
      label: 'Onboarding',
      content: <OnboardingChecklistTab employeeId={employee.employee_id} />
    },
    {
      label: 'Audit Trail',
      content: <EmployeeAuditTrail 
        employeeId={employee.employee_id} 
        employeeName={`${employee.first_name} ${employee.last_name}`} 
      />
    }
  ];

  return (
    <div className="space-y-6">
        <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex flex-col space-y-4 sm:flex-row sm:space-y-0 sm:justify-between sm:items-center">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">
                {employee.first_name} {employee.last_name}
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                <span className="truncate">{employee.job_title}</span>
                <span className="hidden sm:inline"> - </span>
                <Link href="/employees" className="font-medium text-blue-600 hover:text-blue-900 sm:inline-block block mt-1 sm:mt-0">Back to all employees</Link>
              </p>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <Link 
                href={`/employees/${employee.employee_id}/edit`} 
                className="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap min-h-[44px] bg-green-600 text-white shadow-sm hover:bg-green-700 focus:ring-green-500 px-4 sm:px-6 py-3 md:py-2 text-sm sm:text-base"
              >
                <PencilSquareIcon className="-ml-0.5 mr-1.5 h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
                <span className="hidden sm:inline">Edit</span>
                <span className="sm:hidden">Edit</span>
              </Link>
              <DeleteEmployeeButton
                employeeId={employee.employee_id}
                employeeName={`${employee.first_name} ${employee.last_name}`}
              />
            </div>
          </div>
        </div>
      </div>

      <EmployeeRecentChanges employeeId={employee.employee_id} />

      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <Tabs tabs={tabs} className="mobile-tabs" />
      </div>

      {/* Employee Notes Section */}
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <div className="px-4 py-4 sm:p-6">
          <h3 className="text-lg sm:text-xl leading-6 font-semibold text-gray-900 mb-1">
            Employee Notes
          </h3>
          <p className="text-xs sm:text-sm text-gray-500 mb-4">Record of time-stamped updates and comments.</p>

          <AddEmployeeNoteForm employeeId={employee.employee_id} />

          <div className="mt-6">
            <Suspense fallback={<div className="text-center text-gray-500 py-4">Loading notes...</div>}>
              <EmployeeNotesList employeeId={employee.employee_id} />
            </Suspense>
          </div>
        </div>
      </div>

      {/* Employee Attachments Section */}
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <div className="px-4 py-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 mb-4">
            <div className="min-w-0 flex-1">
              <h3 className="text-lg sm:text-xl leading-6 font-semibold text-gray-900 mb-1">
                Employee Attachments
              </h3>
              <p className="text-xs sm:text-sm text-gray-500">Scanned documents and other attached files.</p>
            </div>
            <Link
              href="/settings/categories"
              className="text-xs sm:text-sm text-blue-600 hover:text-blue-900 whitespace-nowrap"
            >
              Manage Categories
            </Link>
          </div>

          <AddEmployeeAttachmentForm 
            employeeId={employee.employee_id} 
            onSuccess={loadData}
          />

          <div className="mt-6">
             <EmployeeAttachmentsList
                employeeId={employee.employee_id}
                attachments={attachments}
                categoriesMap={attachmentCategoriesMap}
                onDelete={loadData}
              />
          </div>
        </div>
      </div>

    </div>
  );
} 