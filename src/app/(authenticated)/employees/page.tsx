'use client'

import { useState, useMemo } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import Link from 'next/link'
import type { Employee } from '@/types/database'
import { PlusIcon, ArrowDownTrayIcon, ChevronDownIcon, CakeIcon } from '@heroicons/react/24/outline'
import { formatDate } from '@/lib/dateUtils'
import { exportEmployees } from '@/app/actions/employeeExport'
import { usePagination } from '@/hooks/usePagination'
import { calculateLengthOfService } from '@/lib/employeeUtils'
// New UI components
import { Page } from '@/components/ui-v2/layout/Page'
import { Card } from '@/components/ui-v2/layout/Card'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { Button } from '@/components/ui-v2/forms/Button'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { SearchInput } from '@/components/ui-v2/forms/SearchInput'
import { StatusBadge } from '@/components/ui-v2/display/Badge'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Dropdown } from '@/components/ui-v2/navigation/Dropdown'
import { Pagination as PaginationV2 } from '@/components/ui-v2/navigation/Pagination'
import { Skeleton } from '@/components/ui-v2/feedback/Skeleton'
import { TabNav } from '@/components/ui-v2/navigation/TabNav'

export default function EmployeesPage() {
  const supabase = useSupabase()
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Former' | 'Prospective'>('Active')

  // Memoize query configuration to prevent unnecessary re-renders
  const queryConfig = useMemo(() => ({
    select: '*',
    orderBy: { column: 'employment_start_date', ascending: true },
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
    return (
      <Page title="Employees">
        <Card>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </Card>
      </Page>
    )
  }

  return (
    <Page
      title="Employees"
      description={`${employees.length} total employees (${activeCount} active, ${prospectiveCount} prospective, ${formerCount} former)`}
      actions={
        <div className="flex-shrink-0 flex space-x-2">
          <LinkButton
            href="/employees/birthdays"
            variant="secondary"
          >
            <CakeIcon className="-ml-1 mr-2 h-5 w-5" />
            Birthdays
          </LinkButton>
          <Dropdown label="Export"
            icon={<ArrowDownTrayIcon className="h-5 w-5" />}
            items={[
              {
                key: 'csv',
                label: 'Export as CSV',
                description: 'Spreadsheet format',
                onClick: () => handleExport('csv'),
              },
              {
                key: 'json',
                label: 'Export as JSON',
                description: 'Data integration format',
                onClick: () => handleExport('json'),
              },
            ]}
            disabled={employees.length === 0}
            variant="secondary"
          />
          <LinkButton
            href="/employees/new"
            variant="primary"
          >
            <PlusIcon className="-ml-1 mr-2 h-5 w-5 flex-shrink-0" />
            Add Employee
          </LinkButton>
        </div>
      }
    >

      <Card>
        <div className="space-y-4">
          <SearchInput
            placeholder="Search by name, email, or job title..."
            value={searchTerm}
            onSearch={setSearchTerm}
          />
          
          <TabNav
            tabs={[
              { key: 'all', label: 'All', badge: employees.length },
              { key: 'Active', label: 'Active', badge: activeCount },
              { key: 'Prospective', label: 'Prospective', badge: prospectiveCount },
              { key: 'Former', label: 'Former', badge: formerCount },
            ]}
            activeKey={statusFilter}
            onChange={(tab) => setStatusFilter(tab as 'all' | 'Active' | 'Former' | 'Prospective')}
          />
          
          {/* Search Results Count */}
          {searchTerm && (
            <div className="mt-2 text-sm text-gray-500">
              Found {employees.length} employee{employees.length !== 1 ? 's' : ''} matching &quot;{searchTerm}&quot;
            </div>
          )}
        </div>
      </Card>
        
      {employees.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <h3 className="text-lg font-medium text-gray-900">No employees found</h3>
            <p className="mt-1 text-sm text-gray-500">
              {searchTerm 
                ? <>No employees match your search for &quot;{searchTerm}&quot;</>
                : 'Get started by adding a new employee.'}
            </p>
          </div>
        </Card>
      ) : (
        <Card>
          <DataTable
            data={employees}
            getRowKey={(employee) => employee.employee_id}
            columns={[
              {
                key: 'name',
                header: 'Name',
                cell: (employee) => (
                  <Link href={`/employees/${employee.employee_id}`} className="text-blue-600 hover:text-blue-700 font-medium">
                    {employee.first_name} {employee.last_name}
                  </Link>
                ),
              },
              {
                key: 'job_title',
                header: 'Job Title',
                cell: (employee) => employee.job_title,
              },
              {
                key: 'email_address',
                header: 'Email',
                cell: (employee) => (
                  <a href={`mailto:${employee.email_address}`} className="text-blue-600 hover:text-blue-700">
                    {employee.email_address}
                  </a>
                ),
              },
              {
                key: 'employment_start_date',
                header: 'Start Date',
                cell: (employee) => (
                  <div>
                    <div>
                      {employee.employment_start_date 
                        ? formatDate(employee.employment_start_date)
                        : 'N/A'}
                    </div>
                    <div className="text-xs text-gray-400">
                      {calculateLengthOfService(employee.employment_start_date)}
                    </div>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                cell: (employee) => (
                  <StatusBadge
                    status={employee.status === 'Active' ? 'success' : employee.status === 'Prospective' ? 'pending' : 'inactive'}
                  >
                    {employee.status}
                  </StatusBadge>
                ),
              },
            ]}
          />
          
          {/* Pagination */}
          {totalPages > 1 && (
            <PaginationV2
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={totalCount}
              itemsPerPage={pageSize}
              onPageChange={setPage}
            />
          )}
        </Card>
      )}
    </Page>
  )
}