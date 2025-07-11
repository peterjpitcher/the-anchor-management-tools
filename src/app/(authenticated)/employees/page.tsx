'use client'

import { useState, Fragment, useMemo } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import Link from 'next/link'
import type { Employee } from '@/types/database'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PlusIcon, MagnifyingGlassIcon, ArrowDownTrayIcon, ChevronDownIcon } from '@heroicons/react/24/outline'
import { Menu, Transition } from '@headlessui/react'
import { formatDate } from '@/lib/dateUtils'
import toast from 'react-hot-toast'
import { exportEmployees } from '@/app/actions/employeeExport'
import { usePagination } from '@/hooks/usePagination'
import { Pagination } from '@/components/Pagination'
import { PageLoadingSkeleton } from '@/components/ui/SkeletonLoader'

export default function EmployeesPage() {
  const supabase = useSupabase()
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Former' | 'Prospective'>('Active')

  // Memoize query configuration to prevent unnecessary re-renders
  const queryConfig = useMemo(() => ({
    select: '*',
    orderBy: { column: 'last_name', ascending: true },
    filters: statusFilter === 'all' ? [] : [
      { column: 'status', operator: 'eq', value: statusFilter }
    ]
  }), [statusFilter])

  const paginationOptions = useMemo(() => ({
    pageSize: 50,
    searchTerm: searchTerm,
    searchColumns: ['first_name', 'last_name', 'email_address', 'job_title']
  }), [searchTerm])

  // Use pagination hook with search and filters
  const {
    data: employees,
    currentPage,
    totalPages,
    totalCount,
    pageSize,
    isLoading: loading,
    setPage
  } = usePagination<Employee>(
    supabase,
    'employees',
    queryConfig,
    paginationOptions
  )


  const activeCount = employees.filter(e => e.status === 'Active').length
  const formerCount = employees.filter(e => e.status === 'Former').length
  const prospectiveCount = employees.filter(e => e.status === 'Prospective').length

  async function handleExport(format: 'csv' | 'json') {
    try {
      const result = await exportEmployees({
        format,
        statusFilter: statusFilter === 'all' ? undefined : statusFilter
      })

      if (result.error) {
        toast.error(result.error)
        return
      }

      if (result.data && result.filename) {
        // Create a blob and download
        const blob = new Blob([result.data], {
          type: format === 'csv' ? 'text/csv' : 'application/json'
        })
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = result.filename
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
        
        toast.success(`Exported ${employees.length} employees`)
      }
    } catch (error) {
      console.error('Export error:', error)
      toast.error('Failed to export employees')
    }
  }

  if (loading) {
    return <PageLoadingSkeleton />
  }

  return (
    <div className="space-y-6">
        <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex flex-col space-y-4 sm:flex-row sm:space-y-0 sm:justify-between sm:items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
              <p className="mt-1 text-sm text-gray-500">
                {employees.length} total employees ({activeCount} active, {prospectiveCount} prospective, {formerCount} former)
              </p>
            </div>
            <div className="flex-shrink-0 flex space-x-2">
              <Menu as="div" className="relative inline-block text-left">
                <div>
                  <Menu.Button
                    className="inline-flex justify-center items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={employees.length === 0}
                  >
                    <ArrowDownTrayIcon className="-ml-1 mr-2 h-5 w-5" />
                    Export
                    <ChevronDownIcon className="ml-2 -mr-1 h-5 w-5" />
                  </Menu.Button>
                </div>
                <Transition
                  as={Fragment}
                  enter="transition ease-out duration-100"
                  enterFrom="transform opacity-0 scale-95"
                  enterTo="transform opacity-100 scale-100"
                  leave="transition ease-in duration-75"
                  leaveFrom="transform opacity-100 scale-100"
                  leaveTo="transform opacity-0 scale-95"
                >
                  <Menu.Items className="origin-top-right absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-10">
                    <div className="py-1">
                      <Menu.Item>
                        {({ active }) => (
                          <button
                            onClick={() => handleExport('csv')}
                            className={`${
                              active ? 'bg-gray-100 text-gray-900' : 'text-gray-700'
                            } block px-4 py-2 text-sm w-full text-left`}
                          >
                            Export as CSV
                            <span className="block text-xs text-gray-500">Spreadsheet format</span>
                          </button>
                        )}
                      </Menu.Item>
                      <Menu.Item>
                        {({ active }) => (
                          <button
                            onClick={() => handleExport('json')}
                            className={`${
                              active ? 'bg-gray-100 text-gray-900' : 'text-gray-700'
                            } block px-4 py-2 text-sm w-full text-left`}
                          >
                            Export as JSON
                            <span className="block text-xs text-gray-500">Data integration format</span>
                          </button>
                        )}
                      </Menu.Item>
                    </div>
                  </Menu.Items>
                </Transition>
              </Menu>
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
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search Input */}
            <div className="flex-1">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-green-500 focus:border-green-500 sm:text-sm"
                  placeholder="Search by name, email, or job title..."
                />
              </div>
            </div>

            {/* Status Filter */}
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium text-gray-500">Status:</span>
              <div className="flex space-x-1">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-3 py-1 text-sm font-medium rounded-full focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                    statusFilter === 'all'
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                  }`}
                >
                  All ({employees.length})
                </button>
                <button
                  onClick={() => setStatusFilter('Active')}
                  className={`px-3 py-1 text-sm font-medium rounded-full focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                    statusFilter === 'Active'
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                  }`}
                >
                  Active ({activeCount})
                </button>
                <button
                  onClick={() => setStatusFilter('Prospective')}
                  className={`px-3 py-1 text-sm font-medium rounded-full focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                    statusFilter === 'Prospective'
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                  }`}
                >
                  Prospective ({prospectiveCount})
                </button>
                <button
                  onClick={() => setStatusFilter('Former')}
                  className={`px-3 py-1 text-sm font-medium rounded-full focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                    statusFilter === 'Former'
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                  }`}
                >
                  Former ({formerCount})
                </button>
              </div>
            </div>
          </div>

          {/* Search Results Count */}
          {searchTerm && (
            <div className="mt-2 text-sm text-gray-500">
              Found {employees.length} employee{employees.length !== 1 ? 's' : ''} matching &quot;{searchTerm}&quot;
            </div>
          )}
        </div>
        
        {employees.length === 0 && (
          <div className="text-center py-12">
            <h3 className="text-lg font-medium text-gray-900">No employees found</h3>
            <p className="mt-1 text-sm text-gray-500">
              {searchTerm 
                ? <>No employees match your search for &quot;{searchTerm}&quot;</>
                : 'Get started by adding a new employee.'}
            </p>
          </div>
        )}
        
        {employees.length > 0 && (
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
                        <Link href={`/employees/${employee.employee_id}`} className="text-blue-600 hover:text-blue-700">
                          {employee.first_name} {employee.last_name}
                        </Link>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{employee.job_title}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <a href={`mailto:${employee.email_address}`} className="text-blue-600 hover:text-blue-700">
                          {employee.email_address}
                        </a>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {employee.employment_start_date 
                          ? formatDate(employee.employment_start_date)
                          : 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <Badge variant={employee.status === 'Active' ? 'success' : employee.status === 'Prospective' ? 'info' : 'error'}>
                          {employee.status}
                        </Badge>
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
                        <p className="text-sm font-medium text-blue-600 truncate">{employee.first_name} {employee.last_name}</p>
                        <div className="ml-2 flex-shrink-0 flex">
                          <Badge variant={employee.status === 'Active' ? 'success' : employee.status === 'Prospective' ? 'info' : 'error'}>
                            {employee.status}
                          </Badge>
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
        
        {/* Pagination */}
        {totalPages > 1 && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalCount}
            itemsPerPage={pageSize}
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  )
}