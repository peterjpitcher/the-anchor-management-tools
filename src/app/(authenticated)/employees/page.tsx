import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import type { Employee } from '@/types/database'; // Import Employee type
import { Button } from '@/components/ui/Button';
import { PlusIcon } from '@heroicons/react/24/outline';
import { formatDate } from '@/lib/dateUtils';

// Create admin client for server-side data fetching
function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('Missing Supabase URL or Service Role Key for admin client.');
    return null;
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

async function getEmployees(statusFilter?: string): Promise<Employee[] | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    console.error('Failed to initialize Supabase admin client');
    return null;
  }

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
    const base = "inline-flex items-center px-3 py-1 text-sm font-medium rounded-full";
    const isActive = (!currentStatusFilter && !filterValue) || currentStatusFilter === filterValue;
    return isActive 
      ? `${base} bg-green-600 text-white` 
      : `${base} bg-gray-100 text-gray-800 hover:bg-gray-200`;
  };

  return (
    <div className="space-y-6">
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex flex-col space-y-4 sm:flex-row sm:space-y-0 sm:justify-between sm:items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
              <p className="mt-1 text-sm text-gray-500">
                A list of all employees including their name, title, and status.
              </p>
            </div>
            <div className="flex-shrink-0">
              <Button asChild>
                <Link href="/employees/new">
                  <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
                  Add Employee
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6 border-b border-gray-200">
           <div className="flex items-center space-x-2">
            <span className="text-sm font-medium text-gray-500">Filter by:</span>
            <Link href="/employees" className={filterLinkClasses()}>All</Link>
            <Link href="/employees?status=Active" className={filterLinkClasses('Active')}>Active</Link>
            <Link href="/employees?status=Former" className={filterLinkClasses('Former')}>Former</Link>
          </div>
        </div>
        
        {!employees && (
          <div className="text-center py-12">
            <p className="text-lg text-gray-600">Could not load employee data.</p>
          </div>
        )}

        {employees && employees.length === 0 && (
          <div className="text-center py-12">
            <h3 className="text-lg font-medium text-gray-900">No employees found</h3>
            <p className="mt-1 text-sm text-gray-500">
              Get started by adding a new employee.
            </p>
          </div>
        )}
        
        {employees && employees.length > 0 && (
          <div>
            {/* Desktop Table */}
            <div className="overflow-x-auto hidden md:block">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Job Title
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Start Date
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {employees.map((employee) => (
                    <tr key={employee.employee_id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <Link href={`/employees/${employee.employee_id}`} className="text-indigo-600 hover:text-indigo-900">
                          {employee.first_name} {employee.last_name}
                        </Link>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{employee.job_title}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <a href={`mailto:${employee.email_address}`} className="text-indigo-600 hover:text-indigo-900">
                          {employee.email_address}
                        </a>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {employee.employment_start_date 
                          ? formatDate(employee.employment_start_date)
                          : 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
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

            {/* Mobile List */}
            <div className="block md:hidden">
              <ul className="divide-y divide-gray-200">
                {employees.map((employee) => (
                  <li key={employee.employee_id} className="px-4 py-4 sm:px-6">
                    <Link href={`/employees/${employee.employee_id}`} className="block hover:bg-gray-50">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-indigo-600 truncate">{employee.first_name} {employee.last_name}</p>
                        <div className="ml-2 flex-shrink-0 flex">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium 
                              ${employee.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}
                          >
                            {employee.status}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 sm:flex sm:justify-between">
                        <div className="sm:flex">
                          <p className="flex items-center text-sm text-gray-500">{employee.job_title}</p>
                        </div>
                        <div className="mt-2 flex items-center text-sm text-gray-500 sm:mt-0">
                          <p>
                            Started: {employee.employment_start_date 
                              ? formatDate(employee.employment_start_date)
                              : 'N/A'}
                          </p>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 