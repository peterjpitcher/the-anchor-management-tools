'use client'

import React, { useCallback, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { usePermissions } from '@/contexts/PermissionContext'
import { toast } from '@/ds'
import { exportEmployees } from '@/app/actions/employeeExport'
import { sendPortalInvite } from '@/app/actions/employeeInvite'
import type { EmployeeRosterResult } from '@/app/actions/employeeQueries'
import type { EmployeeRosterEmployee } from '@/services/employees'
import { formatDate } from '@/lib/dateUtils'
import { calculateLengthOfService } from '@/lib/employeeUtils'
import { displayName, displayNameWithLegal } from '@/lib/employees/display-name'
import InviteEmployeeModal from '@/components/features/employees/InviteEmployeeModal'

import {
  PageLayout,
  Card,
  Stat,
  StatGrid,
  Badge,
  Button,
  LinkButton,
  Avatar,
  SearchInput,
  Segmented,
  Empty,
  Dropdown,
  DropdownItem,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TablePagination,
  Icon,
} from '@/ds'
import { EMPLOYEES_NAV } from '../_shared/nav'
import { employmentStatusTone } from '../_shared/status-ui'

type EmployeeStatus = 'all' | 'Active' | 'Former' | 'Onboarding' | 'Started Separation'

interface EmployeesClientProps {
  initialData: EmployeeRosterResult
  initialError?: string | null
  permissions: { canCreate: boolean; canExport: boolean; canEdit: boolean }
}

// Onboarding rows have no name on them yet, so the email address stays the fallback.
// A preferred name on its own is enough to name someone, even before the legal name
// has been filled in.
function hasNameToShow(employee: EmployeeRosterEmployee): boolean {
  return Boolean((employee.first_name && employee.last_name) || employee.preferred_name)
}

function employeeDisplayName(employee: EmployeeRosterEmployee): string {
  if (hasNameToShow(employee)) return displayName(employee, employee.email_address)
  return employee.email_address
}

// The list keeps the legal name alongside so people can still be found by the name on
// their paperwork.
function employeeListName(employee: EmployeeRosterEmployee): string {
  if (hasNameToShow(employee)) return displayNameWithLegal(employee, employee.email_address)
  return employee.email_address
}

function PortalInviteButton({ employeeId }: { employeeId: string }) {
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    if (pending || sent) return
    setPending(true)
    const result = await sendPortalInvite(employeeId)
    setPending(false)
    if (result.type === 'success') { setSent(true); toast.success(result.message) }
    else { toast.error(result.message) }
  }

  if (sent) return <span className="text-xs text-success-fg">Invite sent</span>
  return (
    <Button type="button" variant="link" size="sm" onClick={handleClick} disabled={pending}>
      {pending ? 'Sending...' : 'Send Portal Invite'}
    </Button>
  )
}

export default function EmployeesClient({ initialData, initialError, permissions }: EmployeesClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [showInviteModal, setShowInviteModal] = useState(false)
  const { hasPermission } = usePermissions()
  const canManageSettings = hasPermission('settings', 'manage')

  const roster = initialData
  const selectedStatus = initialData.filters.statusFilter
  const searchTerm = initialData.filters.searchTerm
  const currentPage = initialData.pagination.page
  const pageSize = initialData.pagination.pageSize
  const currentEmployees = roster.employees

  const updateFilters = useCallback((updates: { status?: EmployeeStatus; search?: string; page?: number }) => {
    const params = new URLSearchParams(searchParams.toString())
    let hasChanges = false
    if (updates.status !== undefined && updates.status !== selectedStatus) {
      params.set('status', updates.status)
      if (updates.page === undefined) params.set('page', '1')
      hasChanges = true
    }
    if (updates.search !== undefined && updates.search !== searchTerm) {
      if (updates.search) params.set('search', updates.search); else params.delete('search')
      if (updates.page === undefined) params.set('page', '1')
      hasChanges = true
    }
    if (updates.page !== undefined && updates.page !== currentPage) {
      params.set('page', updates.page.toString()); hasChanges = true
    }
    if (hasChanges) startTransition(() => { router.push(`${pathname}?${params.toString()}`) })
  }, [searchParams, pathname, router, selectedStatus, searchTerm, currentPage])

  const handleExport = useCallback(async (format: 'csv' | 'json') => {
    if (!permissions.canExport) { toast.error('No permission to export.'); return }
    try {
      const result = await exportEmployees({ format, statusFilter: selectedStatus === 'all' ? undefined : selectedStatus })
      if (result.error) { toast.error(result.error); return }
      if (!result.data || !result.filename) { toast.error('Export failed.'); return }
      const blob = new Blob([result.data], { type: format === 'csv' ? 'text/csv' : 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = result.filename
      document.body.appendChild(a); a.click(); window.URL.revokeObjectURL(url); document.body.removeChild(a)
      toast.success(`Exported ${roster.employees.length} employees`)
    } catch { toast.error('Failed to export.') }
  }, [permissions.canExport, roster.employees.length, selectedStatus])

  const headerActions = (
    <>
      {canManageSettings && (
        <LinkButton href="/settings/pay-bands" variant="secondary" size="sm">Pay Bands</LinkButton>
      )}
      {permissions.canExport && (
        <Dropdown
          trigger={<Button variant="secondary" size="sm" icon={<Icon name="download" size={15} />}>Export</Button>}
        >
          <DropdownItem onClick={() => handleExport('csv')}>Export as CSV</DropdownItem>
          <DropdownItem onClick={() => handleExport('json')}>Export as JSON</DropdownItem>
        </Dropdown>
      )}
      {permissions.canCreate && (
        <>
          <Button variant="secondary" size="sm" icon={<Icon name="mail" size={15} />} onClick={() => setShowInviteModal(true)}>
            Invite
          </Button>
          <LinkButton href="/employees/new" variant="primary" size="sm" icon={<Icon name="plus" size={15} />}>
            New Employee
          </LinkButton>
        </>
      )}
    </>
  )

  return (
    <>
      <PageLayout
        title="Employees"
        subtitle="The team roster"
        navItems={EMPLOYEES_NAV}
        headerActions={headerActions}
        // A failed load keeps the header and says so, rather than showing an empty roster.
        error={initialError ?? null}
        onRetry={() => router.refresh()}
      >
        <StatGrid columns={4}>
          <Stat label="Active" value={String(roster.statusCounts.active)} />
          <Stat label="Onboarding" value={String(roster.statusCounts.onboarding)} />
          <Stat label="Former" value={String(roster.statusCounts.former)} />
          <Stat label="Total" value={String(roster.statusCounts.all)} />
        </StatGrid>

        {/* Filters: status and search, directly above the list they filter */}
        <div className="flex flex-wrap items-end gap-3">
          {/* Five options with counts are wider than a phone, so the switch scrolls sideways
              rather than pushing the page wider than the screen. */}
          <div className="max-w-full overflow-x-auto">
            <Segmented
              aria-label="Employment status"
              options={[
                { id: 'all', label: `All (${roster.statusCounts.all})` },
                { id: 'Active', label: `Active (${roster.statusCounts.active})` },
                { id: 'Onboarding', label: `Onboarding (${roster.statusCounts.onboarding})` },
                { id: 'Started Separation', label: `On Notice (${roster.statusCounts.startedSeparation})` },
                { id: 'Former', label: `Former (${roster.statusCounts.former})` },
              ]}
              value={selectedStatus}
              onChange={(status) => updateFilters({ status: status as EmployeeStatus })}
            />
          </div>
          <SearchInput
            value={searchTerm}
            onChange={(v) => updateFilters({ search: v })}
            debounceDelay={350}
            aria-label="Search employees"
            placeholder="Search by name, role..."
            className="w-full sm:w-60"
          />
          <span className="ml-auto self-center text-xs text-text-muted">{currentEmployees.length} employees</span>
        </div>

        <Card padding="none">
          {currentEmployees.length === 0 ? (
            <Empty
              size="sm"
              title="No employees found"
              description={searchTerm ? `No results for "${searchTerm}"` : 'Add your first employee.'}
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Start Date</TableHead>
                    <TableHead>Holiday</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currentEmployees.map(emp => (
                    <TableRow
                      key={emp.employee_id}
                      onClick={() => router.push(`/employees/${emp.employee_id}`)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={employeeDisplayName(emp)} size="md" />
                          <div>
                            <Link href={`/employees/${emp.employee_id}`} className="text-ui font-semibold text-text-strong hover:text-primary">
                              {employeeListName(emp)}
                            </Link>
                            {!emp.first_name && <span className="text-meta text-text-soft ml-1">(pending)</span>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-ui">{emp.job_title || '--'}</TableCell>
                      <TableCell>
                        <div className="text-ui">{emp.employment_start_date ? formatDate(emp.employment_start_date) : '--'}</div>
                        <div className="text-meta text-text-soft">{calculateLengthOfService(emp.employment_start_date)}</div>
                      </TableCell>
                      <TableCell className="text-ui">{emp.holiday_days_current_year ?? 0} days</TableCell>
                      <TableCell>
                        <Badge tone={employmentStatusTone(emp.status)} dot>{emp.status}</Badge>
                        {!emp.auth_user_id && permissions.canEdit && ['Active', 'Started Separation'].includes(emp.status) && (
                          <div className="mt-1"><PortalInviteButton employeeId={emp.employee_id} /></div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {roster.pagination.totalPages > 1 && (
                <TablePagination
                  page={currentPage}
                  totalPages={roster.pagination.totalPages}
                  totalItems={roster.pagination.totalCount}
                  pageSize={pageSize}
                  onPageChange={(page) => updateFilters({ page })}
                />
              )}
            </>
          )}
        </Card>
      </PageLayout>

      {showInviteModal && (
        <InviteEmployeeModal
          onClose={() => setShowInviteModal(false)}
          onSuccess={() => { setShowInviteModal(false); router.refresh() }}
        />
      )}
    </>
  )
}
