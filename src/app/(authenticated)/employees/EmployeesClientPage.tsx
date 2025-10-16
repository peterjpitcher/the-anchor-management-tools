'use client'

import { useCallback, useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
import { Card } from '@/components/ui-v2/layout/Card'
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup'
import { NavLink } from '@/components/ui-v2/navigation/NavLink'
import { Dropdown } from '@/components/ui-v2/navigation/Dropdown'
import { SearchInput } from '@/components/ui-v2/forms/SearchInput'
import { TabNav } from '@/components/ui-v2/navigation/TabNav'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { StatusBadge } from '@/components/ui-v2/display/Badge'
import { Pagination as PaginationV2 } from '@/components/ui-v2/navigation/Pagination'
import { exportEmployees } from '@/app/actions/employeeExport'
import { getEmployeesRoster, type EmployeeRosterResult } from '@/app/actions/employeeQueries'
import type { Employee } from '@/types/database'
import { formatDate } from '@/lib/dateUtils'
import { calculateLengthOfService } from '@/lib/employeeUtils'

type EmployeeStatus = 'all' | 'Active' | 'Former' | 'Prospective'

interface EmployeesClientPageProps {
  initialData: EmployeeRosterResult
  permissions: {
    canCreate: boolean
    canExport: boolean
  }
}

export default function EmployeesClientPage({ initialData, permissions }: EmployeesClientPageProps) {
  const [roster, setRoster] = useState<EmployeeRosterResult>(initialData)
  const [selectedStatus, setSelectedStatus] = useState<EmployeeStatus>(initialData.filters.statusFilter)
  const [searchTerm, setSearchTerm] = useState(initialData.filters.searchTerm)
  const [currentPage, setCurrentPage] = useState(initialData.pagination.page)
  const [isFetching, setIsFetching] = useState(false)
  const [isPending, startTransition] = useTransition()

  const pageSize = initialData.pagination.pageSize
  const isLoading = isFetching || isPending

  const loadRoster = useCallback(
    (params: { statusFilter?: EmployeeStatus; searchTerm?: string; page?: number } = {}) => {
      const nextStatus = params.statusFilter ?? selectedStatus
      const nextSearch = params.searchTerm ?? searchTerm
      const nextPage = params.page ?? currentPage
      const previousState = {
        status: selectedStatus,
        search: searchTerm,
        page: currentPage
      }

      if (nextStatus === selectedStatus && nextSearch === searchTerm && nextPage === currentPage) {
        return
      }

      setSelectedStatus(nextStatus)
      setSearchTerm(nextSearch)
      setCurrentPage(nextPage)
      setIsFetching(true)

      startTransition(() => {
        getEmployeesRoster({
          statusFilter: nextStatus,
          searchTerm: nextSearch,
          page: nextPage,
          pageSize
        })
          .then((result) => {
            if (result.error) {
              toast.error(result.error)
              setSelectedStatus(previousState.status)
              setSearchTerm(previousState.search)
              setCurrentPage(previousState.page)
              return
            }

            setRoster(result)
            setSelectedStatus(result.filters.statusFilter)
            setSearchTerm(result.filters.searchTerm)
            setCurrentPage(result.pagination.page)
          })
          .catch((error) => {
            if (error instanceof Error && error.name === 'AbortError') {
              return
            }
            console.error('[EmployeesClientPage] Failed to load roster', error)
            toast.error('Failed to load employees.')
            setSelectedStatus(previousState.status)
            setSearchTerm(previousState.search)
            setCurrentPage(previousState.page)
          })
          .finally(() => {
            setIsFetching(false)
          })
      })
    },
    [selectedStatus, searchTerm, currentPage, pageSize]
  )

  const handleExport = useCallback(
    async (format: 'csv' | 'json') => {
      if (!permissions.canExport) {
        toast.error('You do not have permission to export employees.')
        return
      }

      try {
        const result = await exportEmployees({
          format,
          statusFilter: selectedStatus === 'all' ? undefined : selectedStatus
        })

        if (result.error) {
          toast.error(result.error)
          return
        }

        if (!result.data || !result.filename) {
          toast.error('Export completed without a file.')
          return
        }

        const blob = new Blob([result.data], {
          type: format === 'csv' ? 'text/csv' : 'application/json'
        })
        const url = window.URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = result.filename
        document.body.appendChild(anchor)
        anchor.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(anchor)

        toast.success(`Exported ${roster.employees.length} employees`)
      } catch (error) {
        console.error('[EmployeesClientPage] Export failed', error)
        toast.error('Failed to export employees.')
      }
    },
    [permissions.canExport, roster.employees.length, selectedStatus]
  )

  const showSearchResultMessage = Boolean(searchTerm)
  const currentEmployees = roster.employees as Employee[]

  return (
    <PageWrapper>
      <PageHeader
        title="Employees"
        subtitle="Manage your staff and their information"
        backButton={{ label: 'Back to Dashboard', href: '/dashboard' }}
        actions={
          <div className="flex flex-wrap gap-2 sm:gap-3">
            <NavGroup>
              {permissions.canCreate && (
                <NavLink href="/employees/new">
                  Add Employee
                </NavLink>
              )}
              <NavLink href="/employees/birthdays">
                Birthdays
              </NavLink>
            </NavGroup>
            {permissions.canExport && (
              <Dropdown
                label="Export"
                icon={<ArrowDownTrayIcon className="h-4 w-4" />}
                items={[
                  {
                    key: 'csv',
                    label: 'Export as CSV',
                    description: 'Spreadsheet format',
                    onClick: () => handleExport('csv')
                  },
                  {
                    key: 'json',
                    label: 'Export as JSON',
                    description: 'Data integration format',
                    onClick: () => handleExport('json')
                  }
                ]}
                disabled={isLoading || currentEmployees.length === 0}
                variant="secondary"
                size="sm"
              />
            )}
          </div>
        }
      />

      <PageContent>
        <Card>
          <div className="space-y-4">
            <SearchInput
              placeholder="Search by name, email, or job title..."
              defaultValue={initialData.filters.searchTerm}
              onSearch={(value) => loadRoster({ searchTerm: value, page: 1 })}
              loading={isLoading}
            />

            <TabNav
              tabs={[
                { key: 'all', label: 'All', mobileLabel: 'All', badge: roster.statusCounts.all },
                { key: 'Active', label: 'Active', mobileLabel: 'Active', badge: roster.statusCounts.active },
                { key: 'Prospective', label: 'Prospective', mobileLabel: 'Prosp.', badge: roster.statusCounts.prospective },
                { key: 'Former', label: 'Former', mobileLabel: 'Former', badge: roster.statusCounts.former }
              ]}
              activeKey={selectedStatus}
              onChange={(tab) => loadRoster({ statusFilter: tab as EmployeeStatus, page: 1 })}
            />

            {showSearchResultMessage && (
              <div className="mt-2 text-sm text-gray-500">
                Found {currentEmployees.length} employee{currentEmployees.length !== 1 ? 's' : ''} matching &quot;{searchTerm}&quot;
              </div>
            )}
          </div>
        </Card>

        {currentEmployees.length === 0 ? (
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
              data={currentEmployees}
              getRowKey={(employee) => employee.employee_id}
              loading={isLoading}
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  cell: (employee: Employee) => (
                    <Link href={`/employees/${employee.employee_id}`} className="text-blue-600 hover:text-blue-700 font-medium">
                      {employee.first_name} {employee.last_name}
                    </Link>
                  )
                },
                {
                  key: 'job_title',
                  header: 'Job Title',
                  cell: (employee: Employee) => employee.job_title
                },
                {
                  key: 'email_address',
                  header: 'Email',
                  cell: (employee: Employee) => (
                    <a href={`mailto:${employee.email_address}`} className="text-blue-600 hover:text-blue-700">
                      {employee.email_address}
                    </a>
                  )
                },
                {
                  key: 'employment_start_date',
                  header: 'Start Date',
                  cell: (employee: Employee) => (
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
                  )
                },
                {
                  key: 'status',
                  header: 'Status',
                  cell: (employee: Employee) => (
                    <StatusBadge
                      status={
                        employee.status === 'Active'
                          ? 'success'
                          : employee.status === 'Prospective'
                            ? 'pending'
                            : 'inactive'
                      }
                    >
                      {employee.status}
                    </StatusBadge>
                  )
                }
              ]}
            />

            {roster.pagination.totalPages > 1 && (
              <PaginationV2
                currentPage={currentPage}
                totalPages={roster.pagination.totalPages}
                totalItems={roster.pagination.totalCount}
                itemsPerPage={pageSize}
                onPageChange={(page) => loadRoster({ page })}
              />
            )}
          </Card>
        )}
      </PageContent>
    </PageWrapper>
  )
}
