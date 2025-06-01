import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { PlusIcon } from '@heroicons/react/24/outline';
import type { Employee } from '@/types/database'; // Import Employee type

async function getEmployees(): Promise<Employee[] | null> {
  const { data, error } = await supabase.from('employees').select('*').order('last_name').order('first_name');

  if (error) {
    console.error('Error fetching employees:', error);
    // In a real app, you might throw the error or return a specific error object
    return null;
  }
  return data;
}

export default async function EmployeesPage() {
  const employees = await getEmployees();

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold leading-6 text-gray-900">Employees</h1>
          <p className="mt-2 text-sm text-gray-700">
            A list of all the employees in your company including their name, title, email and status.
          </p>
        </div>
        <div className="mt-4 sm:ml-16 sm:mt-0 sm:flex-none">
          <Link
            href="/employees/new" // Link to be created later
            className="inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary-emphasis focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <PlusIcon className="-ml-0.5 mr-1.5 h-5 w-5" aria-hidden="true" />
            Add Employee
          </Link>
        </div>
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
                        Status
                      </th>
                      <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                        <span className="sr-only">Edit</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {employees.map((employee) => (
                      <tr key={employee.employee_id}>
                        <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                          {employee.first_name} {employee.last_name}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{employee.job_title}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{employee.email_address}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium 
                              ${employee.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}
                          >
                            {employee.status}
                          </span>
                        </td>
                        <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                          <Link href={`/employees/${employee.employee_id}`} className="text-secondary hover:text-secondary-emphasis">
                            View<span className="sr-only">, {employee.first_name} {employee.last_name}</span>
                          </Link>
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