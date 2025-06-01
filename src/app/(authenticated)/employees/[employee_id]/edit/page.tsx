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

interface EditEmployeePageProps {
  params: { employee_id: string };
}

export default async function EditEmployeePage({ params }: EditEmployeePageProps) {
  const employee = await getEmployee(params.employee_id);

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
          initialFormState={null} // Or provide initial success/error state if needed from a redirect
        />
      </div>
    </div>
  );
} 