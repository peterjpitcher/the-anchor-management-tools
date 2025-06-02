import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import type { Employee } from '@/types/database'; // Import Employee type
import { Button } from '@/components/ui/Button';

async function getEmployees(statusFilter?: string): Promise<Employee[] | null> {
  let query = supabase.from('employees').select('*').order('last_name').order('first_name');

  if (statusFilter === 'Active' || statusFilter === 'Former') {
    query = query.eq('status', statusFilter);
  }
  // If statusFilter is undefined or an invalid value, it fetches all employees.

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching employees:', error);
    // In a real app, you might throw the error or return a specific error object
    return null;
  }
  return data;
}

// Using inline props type to avoid potential global PageProps conflicts
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Resolve searchParams promise
  const resolvedSearchParams = await searchParams;
  // Ensure status is treated as a string if it exists, or undefined
  const currentStatusFilter = typeof resolvedSearchParams?.status === 'string' ? resolvedSearchParams.status : undefined;
  const employees = await getEmployees(currentStatusFilter);

  const filterLinkClasses = (filterValue?: string) => {
    const base = "px-3 py-1 text-sm font-medium rounded-md";
    const isActive = (!currentStatusFilter && !filterValue) || currentStatusFilter === filterValue;
    return isActive ? `${base} bg-primary text-white` : `${base} bg-gray-200 text-gray-700 hover:bg-gray-300`;
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold leading-6 text-gray-900">Employees</h1>
          <p className="mt-2 text-sm text-gray-700">
            A list of all employees including their name, title, email and status.
          </p>
        </div>
        <div className="mt-4 sm:ml-16 sm:mt-0 sm:flex-none">
          <Button asChild variant="primary" size="md">
            <Link href="/employees/new" className="text-white">
              Add Employee
            </Link>
          </Button>
        </div>
      </div>

      <div className="mb-6 flex items-center space-x-2">
        <span className="text-sm font-medium text-gray-700">Filter by status:</span>
        <Link href="/employees" className={filterLinkClasses()}>All</Link>
        <Link href="/employees?status=Active" className={filterLinkClasses('Active')}>Active</Link>
        <Link href="/employees?status=Former" className={filterLinkClasses('Former')}>Former</Link>
      </div>

      {!employees && (
        <div className="mt-8 text-center">
          <p className="text-lg text-gray-600">Could not load employee data. Please try again later.</p>
        </div>
      )}

      {employees && employees.length === 0 && (
        <div className="mt-8 text-center">
          <p className="text-lg text-gray-600">No employees found.</p>
          <p className="mt-1 text-sm text-gray-500">Get started by adding a new employee.</p>
        </div>
      )}

      {employees && employees.length > 0 && (
        <div className="mt-8 flow-root">
          <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
            <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
              <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
                <table className="min-w-full divide-y divide-gray-300">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">
                        Name
                      </th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                        Job Title
                      </th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                        Email
                      </th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                        Start Date
                      </th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {employees.map((employee) => (
                      <tr key={employee.employee_id}>
                        <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                          <Link href={`/employees/${employee.employee_id}`} className="text-primary hover:text-primary/80">
                            {employee.first_name} {employee.last_name}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{employee.job_title}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{employee.email_address}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                          {employee.employment_start_date 
                            ? new Date(employee.employment_start_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                            : 'N/A'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium 
                              ${employee.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}
                          >
                            {employee.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 