import EmployeeForm from '@/components/EmployeeForm';
import { updateEmployee } from '@/app/actions/employeeActions';
import { supabase } from '@/lib/supabase';
import type { Employee } from '@/types/database';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';

async function getEmployee(id: string): Promise<Employee | null> {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('employee_id', id)
    .single();

  if (error) {
    console.error('Error fetching employee for edit:', error);
    return null;
  }
  return data;
}

// Ideal props definition (can be kept for clarity or removed if it causes issues with the workaround)
// type EditEmployeePageProps = {
//   params: { employee_id: string };
//   searchParams: { [key: string]: string | string[] | undefined };
// };

// Removed @ts-expect-error as build indicated it was unused with {params: any}
export default async function EditEmployeePage({ params, searchParams }: { params: any, searchParams: any }) {
  const employee_id = params?.employee_id as string;
  
  if (!employee_id) {
    console.error("Employee ID is missing from params");
    notFound();
  }

  const employee = await getEmployee(employee_id);

  if (!employee) {
    notFound();
  }

  // Bind the employee_id to the updateEmployee server action
  const updateEmployeeWithId = updateEmployee.bind(null, employee.employee_id);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <Link href={`/employees/${employee.employee_id}`} className="inline-flex items-center text-sm font-medium text-gray-600 hover:text-gray-800">
            <ArrowLeftIcon className="mr-2 h-5 w-5" />
            Back to Employee Details
          </Link>
        </div>
        <EmployeeForm 
          employee={employee} 
          formAction={updateEmployeeWithId} 
          initialFormState={null} 
        />
      </div>
    </div>
  );
} 