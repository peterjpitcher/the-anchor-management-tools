import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Employee, EmployeeAttachment, AttachmentCategory } from '@/types/database';
import { ArrowLeftIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import DeleteEmployeeButton from '@/components/DeleteEmployeeButton';
import EmployeeNotesList from '@/components/EmployeeNotesList';
import AddEmployeeNoteForm from '@/components/AddEmployeeNoteForm';
import EmployeeAttachmentsList from '@/components/EmployeeAttachmentsList';
import AddEmployeeAttachmentForm from '@/components/AddEmployeeAttachmentForm';
import { Suspense } from 'react';
import { Button } from '@/components/ui/Button';

async function getEmployee(id: string): Promise<Employee | null> {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('employee_id', id)
    .single();

  if (error) {
    console.error('Error fetching employee:', error);
    return null;
  }
  return data;
}

async function getEmployeeAttachments(employeeId: string): Promise<EmployeeAttachment[] | null> {
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
}

async function getAttachmentCategories(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('attachment_categories').select('category_id, category_name');
  const map = new Map<string, string>();
  if (error) {
    console.error('Error fetching attachment categories:', error);
    return map;
  }
  data?.forEach(cat => map.set(cat.category_id, cat.category_name));
  return map;
}

// Commenting out original props interface for the workaround
// interface EmployeeDetailPageProps {
//   params: { employee_id: string };
// }

// Removed @ts-expect-error as build indicated it was unused
export default async function EmployeeDetailPage({ params }: { params: any, searchParams?: any }) {
  // Remove await for params, as params from props is not a Promise
  // const resolvedParams = await pageParams; 
  const employee_id = params?.employee_id as string;

  if (!employee_id) {
    console.error("Employee ID is missing from params for detail page");
    notFound();
  }

  const employee = await getEmployee(employee_id);

  if (!employee) {
    notFound();
  }

  const [attachments, attachmentCategoriesMap] = await Promise.all([
    getEmployeeAttachments(employee.employee_id),
    getAttachmentCategories()
  ]);

  const displayFields = [
    { label: 'Full Name', value: `${employee.first_name} ${employee.last_name}` },
    { label: 'Email Address', value: employee.email_address },
    { label: 'Job Title', value: employee.job_title },
    { label: 'Employment Status', value: employee.status, isBadge: true },
    { label: 'Start Date', value: employee.employment_start_date ? new Date(employee.employment_start_date).toLocaleDateString() : 'N/A' },
    { label: 'End Date', value: employee.employment_end_date ? new Date(employee.employment_end_date).toLocaleDateString() : 'N/A' },
    { label: 'Date of Birth', value: employee.date_of_birth ? new Date(employee.date_of_birth).toLocaleDateString() : 'N/A' },
    { label: 'Phone Number', value: employee.phone_number || 'N/A' },
    { label: 'Address', value: employee.address || 'N/A', isFullWidth: true },
    { label: 'Emergency Contact', value: `${employee.emergency_contact_name || ''} ${employee.emergency_contact_phone || ''}`.trim() || 'N/A' },
  ];

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <Link href="/employees" className="inline-flex items-center text-sm font-medium text-gray-600 hover:text-gray-800">
            <ArrowLeftIcon className="mr-2 h-5 w-5" />
            Back to Employees
          </Link>
        </div>

        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          <div className="px-4 py-5 sm:px-6 flex justify-between items-center">
            <div>
              <h3 className="text-xl leading-6 font-semibold text-gray-900">
                Employee Details
              </h3>
              <p className="mt-1 max-w-2xl text-sm text-gray-500">
                Personal and employment information.
              </p>
            </div>
            <div className="flex space-x-3">
              <Button asChild variant="primary" size="md">
                <Link href={`/employees/${employee.employee_id}/edit`}>
                  <PencilSquareIcon className="-ml-0.5 mr-1.5 h-5 w-5" aria-hidden="true" />
                  Edit Employee
                </Link>
              </Button>
              <DeleteEmployeeButton 
                employeeId={employee.employee_id} 
                employeeName={`${employee.first_name} ${employee.last_name}`} 
              />
            </div>
          </div>
          <div className="border-t border-gray-200 px-4 py-5 sm:p-0">
            <dl className="sm:divide-y sm:divide-gray-200">
              {displayFields.map((field, index) => (
                <div 
                  key={index} 
                  className={`py-4 sm:py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6 ${field.isFullWidth ? 'sm:grid-cols-1' : ''}`}
                >
                  <dt className="text-sm font-medium text-gray-500">{field.label}</dt>
                  <dd className={`mt-1 text-sm text-gray-900 sm:mt-0 ${field.isFullWidth ? '' : 'sm:col-span-2'}`}>
                    {field.isBadge ? (
                        <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium 
                            ${employee.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}
                        >
                            {field.value}
                        </span>
                    ) : (
                        field.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* Employee Notes Section */}
        <div className="mt-12">
          <h3 className="text-xl leading-6 font-semibold text-gray-900 mb-1">
            Employee Notes
          </h3>
          <p className="text-sm text-gray-500 mb-4">Record of time-stamped updates and comments.</p>
          
          {/* Client component to add notes */}
          <AddEmployeeNoteForm employeeId={employee.employee_id} />

          {/* Server component to list notes, wrapped in Suspense for better UX */}
          <div className="mt-6">
            <Suspense fallback={<div className="text-center text-gray-500 py-4">Loading notes...</div>}>
              <EmployeeNotesList employeeId={employee.employee_id} />
            </Suspense>
          </div>
        </div>

        {/* Employee Attachments Section */}
        <div className="mt-12">
          <h3 className="text-xl leading-6 font-semibold text-gray-900 mb-1">
            Employee Attachments
          </h3>
          <p className="text-sm text-gray-500 mb-4">Scanned documents and other attached files.</p>

          {/* Client component to add attachments */}
          <AddEmployeeAttachmentForm employeeId={employee.employee_id} />
          
          {/* Client component to list attachments, wrapped in Suspense (though data is pre-fetched) */}
          {/* Data is passed as a prop now to EmployeeAttachmentsList */}
          <div className="mt-6">
             <EmployeeAttachmentsList 
                employeeId={employee.employee_id} 
                attachments={attachments} 
                categoriesMap={attachmentCategoriesMap} 
              />
          </div>
        </div>

      </div>
    </div>
  );
} 