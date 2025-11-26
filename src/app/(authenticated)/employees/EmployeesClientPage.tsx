'use client'

import { useCallback, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { ArrowDownTrayIcon, PlusIcon } from '@heroicons/react/24/outline'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Dropdown } from '@/components/ui-v2/navigation/Dropdown'
import { SearchInput } from '@/components/ui-v2/forms/SearchInput'
import { TabNav } from '@/components/ui-v2/navigation/TabNav'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { StatusBadge } from '@/components/ui-v2/display/Badge'
import { Pagination as PaginationV2 } from '@/components/ui-v2/navigation/Pagination'
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { exportEmployees } from '@/app/actions/employeeExport'
import type { EmployeeRosterResult } from '@/app/actions/employeeQueries'
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
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  // Derive state directly from server data
  const roster = initialData
  const selectedStatus = initialData.filters.statusFilter
  const searchTerm = initialData.filters.searchTerm
  const currentPage = initialData.pagination.page
  const pageSize = initialData.pagination.pageSize
  
  const isLoading = isPending

  const updateFilters = useCallback((updates: { status?: EmployeeStatus; search?: string; page?: number }) => {
    const params = new URLSearchParams(searchParams.toString())
    let hasChanges = false
    
    if (updates.status !== undefined && updates.status !== selectedStatus) {
      params.set('status', updates.status)
      // Reset to page 1 when filter changes, unless page is explicitly provided
      if (updates.page === undefined) params.set('page', '1')
      hasChanges = true
    }
    
    if (updates.search !== undefined && updates.search !== searchTerm) {
      if (updates.search) {
        params.set('search', updates.search)
      } else {
        params.delete('search')
      }
      // Reset to page 1 when search changes
      if (updates.page === undefined) params.set('page', '1')
      hasChanges = true
    }
    
    if (updates.page !== undefined && updates.page !== currentPage) {
      params.set('page', updates.page.toString())
      hasChanges = true
    }

    if (hasChanges) {
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`)
      })
    }
  }, [searchParams, pathname, router, selectedStatus, searchTerm, currentPage])

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

  const navItems: HeaderNavItem[] = [
    { label: 'Filters', href: '#filters' },
    { label: 'Birthdays', href: '/employees/birthdays' },
  ]

  const navActions = (
    <div className="flex flex-wrap items-center gap-2">
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
  )

  const headerActions = permissions.canCreate ? (
    <LinkButton href="/employees/new" size="md" variant="primary" leftIcon={<PlusIcon className="h-5 w-5" />}>
      Add Employee
    </LinkButton>
  ) : null

  return (
    <PageLayout
      title="Employees"
      subtitle="Manage your staff and their information"
      navItems={navItems}
      navActions={navActions}
      headerActions={headerActions}
    >
      <section id="filters">
        <Card>
          <div className="space-y-4">
            <SearchInput
              placeholder="Search by name, email, or job title..."
              defaultValue={searchTerm}
              onSearch={(value) => updateFilters({ search: value })}
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
              onChange={(tab) => updateFilters({ status: tab as EmployeeStatus })}
            />

            {showSearchResultMessage && (
              <div className="mt-2 text-sm text-gray-500">
                Found {currentEmployees.length} employee{currentEmployees.length !== 1 ? 's' : ''} matching &quot;{searchTerm}&quot;
              </div>
            )}
          </div>
        </Card>

      </section>

      <section id="roster" className="space-y-6">
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
                  key: 'date_of_birth',
                  header: 'Birthday',
                  cell: (employee: Employee) => (
                    <div className="text-sm text-gray-900">
                      {employee.date_of_birth ? formatDate(employee.date_of_birth) : 'N/A'}
                    </div>
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
                onPageChange={(page) => updateFilters({ page })}
              />
            )}
          </Card>
        )}
      </section>
    </PageLayout>
  )
}
