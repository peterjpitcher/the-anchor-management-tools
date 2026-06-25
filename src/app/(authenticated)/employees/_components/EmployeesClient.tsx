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
import InviteEmployeeModal from '@/components/features/employees/InviteEmployeeModal'

import {
  PageHeader,
  Card,
  CardBody,
  Stat,
  Badge,
  Button,
  Avatar,
  SearchInput,
  Empty,
  Tabs,
  Dropdown,
  DropdownItem,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TablePagination,
} from '@/ds'

import { Icon } from '@/ds/icons'

type EmployeeStatus = 'all' | 'Active' | 'Former' | 'Onboarding' | 'Started Separation'

interface EmployeesClientProps {
  initialData: EmployeeRosterResult
  initialError?: string | null
  permissions: { canCreate: boolean; canExport: boolean; canEdit: boolean }
}

function statusBadgeTone(status: string): 'success' | 'info' | 'warning' | 'neutral' {
  switch (status) {
    case 'Active': return 'success'
    case 'Onboarding': return 'info'
    case 'Started Separation': return 'warning'
    default: return 'neutral'
  }
}

function employeeDisplayName(employee: EmployeeRosterEmployee): string {
  if (employee.first_name && employee.last_name) return `${employee.first_name} ${employee.last_name}`
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

  if (sent) return <span className="text-xs text-success">Invite sent</span>
  return (
    <button type="button" onClick={handleClick} disabled={pending} className="text-xs text-primary hover:underline disabled:opacity-50">
      {pending ? 'Sending...' : 'Send portal invite'}
    </button>
  )
}

export default function EmployeesClient({ initialData, initialError, permissions }: EmployeesClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { hasPermission } = usePermissions()
  const canManageSettings = hasPermission('settings', 'manage')

  const roster = initialData
  const selectedStatus = initialData.filters.statusFilter
  const searchTerm = initialData.filters.searchTerm
  const currentPage = initialData.pagination.page
  const pageSize = initialData.pagination.pageSize
  const currentEmployees = roster.employees

  const selectedEmployee = selectedId ? currentEmployees.find(e => e.employee_id === selectedId) : null

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

  return (
    <>
      <div className="flex flex-col gap-5">
        <PageHeader
          breadcrumbs={[{ label: 'Employees' }]}
          title="Employees"
          subtitle={`${roster.statusCounts.active} active · ${roster.statusCounts.former} former · ${roster.statusCounts.onboarding} onboarding`}
          className="mb-0"
          actions={
            <div className="flex items-center gap-2">
              <Link href="/employees/reliability">
                <Button variant="secondary" size="sm">Reliability</Button>
              </Link>
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
                  <Link href="/employees/new">
                    <Button variant="primary" size="sm" icon={<Icon name="plus" size={15} />}>Add employee</Button>
                  </Link>
                </>
              )}
              {canManageSettings && (
                <Link href="/settings/pay-bands">
                  <Button variant="secondary" size="sm">Pay Bands</Button>
                </Link>
              )}
            </div>
          }
        />

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <Stat label="Active" value={String(roster.statusCounts.active)} />
          <Stat label="Onboarding" value={String(roster.statusCounts.onboarding)} />
          <Stat label="Former" value={String(roster.statusCounts.former)} />
          <Stat label="Total" value={String(roster.statusCounts.all)} />
        </div>

        {/* Tabs */}
        <Tabs
          tabs={[
            { id: 'all', label: `All (${roster.statusCounts.all})` },
            { id: 'Active', label: `Active (${roster.statusCounts.active})` },
            { id: 'Onboarding', label: `Onboarding (${roster.statusCounts.onboarding})` },
            { id: 'Former', label: `Former (${roster.statusCounts.former})` },
          ]}
          activeTab={selectedStatus}
          onTabChange={(tab) => updateFilters({ status: tab as EmployeeStatus })}
        />

        {initialError && (
          <div className="p-3 bg-danger-soft text-danger-fg rounded-lg text-sm">{initialError}</div>
        )}

        {/* Master-detail layout */}
        <div className={`grid gap-4 ${selectedEmployee ? 'grid-cols-[1fr_380px]' : 'grid-cols-1'}`}>
          {/* Left: Table */}
          <Card>
            <div className="flex items-center gap-2 p-3 border-b border-border">
              <SearchInput
                value={searchTerm}
                onChange={(v) => updateFilters({ search: v })}
                placeholder="Search by name, role..."
                className="w-60"
              />
              <div className="flex-1" />
              <span className="text-xs text-text-muted">{currentEmployees.length} employees</span>
            </div>

            {currentEmployees.length === 0 ? (
              <CardBody>
                <Empty title="No employees found" description={searchTerm ? `No results for "${searchTerm}"` : 'Add your first employee.'} />
              </CardBody>
            ) : (
              <>
                <Table className="[--spacing-row-h:10px]">
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
                        className={`cursor-pointer ${selectedId === emp.employee_id ? 'bg-primary-soft' : ''}`}
                        onClick={() => setSelectedId(emp.employee_id)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <Avatar name={employeeDisplayName(emp)} size="md" />
                            <div>
                              <Link href={`/employees/${emp.employee_id}`} className="text-[13px] font-semibold text-text-strong hover:text-primary">
                                {employeeDisplayName(emp)}
                              </Link>
                              {!emp.first_name && <span className="text-[11px] text-text-subtle ml-1">(pending)</span>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-[13px]">{emp.job_title || '--'}</TableCell>
                        <TableCell>
                          <div className="text-[13px]">{emp.employment_start_date ? formatDate(emp.employment_start_date) : '--'}</div>
                          <div className="text-[11px] text-text-subtle">{calculateLengthOfService(emp.employment_start_date)}</div>
                        </TableCell>
                        <TableCell className="text-[13px]">{emp.holiday_days_current_year ?? 0} days</TableCell>
                        <TableCell>
                          <Badge tone={statusBadgeTone(emp.status)} dot>{emp.status}</Badge>
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

          {/* Right: Detail panel */}
          {selectedEmployee && (
            <Card>
              <CardBody className="flex flex-col items-center text-center gap-3 pb-4 border-b border-border">
                <Avatar name={employeeDisplayName(selectedEmployee)} size="lg" />
                <div>
                  <div className="text-base font-semibold text-text-strong">{employeeDisplayName(selectedEmployee)}</div>
                  <div className="text-xs text-text-muted">{selectedEmployee.job_title || 'No role'}</div>
                </div>
                <Badge tone={statusBadgeTone(selectedEmployee.status)} dot>{selectedEmployee.status}</Badge>
              </CardBody>
              <CardBody className="flex flex-col gap-3 text-[13px]">
                <DetailRow label="Email" value={selectedEmployee.email_address} />
                <DetailRow label="Mobile" value={selectedEmployee.mobile_number || '--'} />
                <DetailRow label="Start Date" value={selectedEmployee.employment_start_date ? formatDate(selectedEmployee.employment_start_date) : '--'} />
                <DetailRow label="Service" value={calculateLengthOfService(selectedEmployee.employment_start_date)} />
                <DetailRow label="Holiday" value={`${selectedEmployee.holiday_days_current_year ?? 0} days`} />
                <DetailRow label="Portal" value={selectedEmployee.auth_user_id ? 'Set up' : 'Not set up'} />
                <div className="flex gap-2 pt-3 border-t border-border">
                  <Link href={`/employees/${selectedEmployee.employee_id}`} className="flex-1">
                    <Button variant="primary" size="sm" className="w-full">View Profile</Button>
                  </Link>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      {showInviteModal && (
        <InviteEmployeeModal
          onClose={() => setShowInviteModal(false)}
          onSuccess={() => { setShowInviteModal(false); router.refresh() }}
        />
      )}
    </>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-strong font-medium">{value}</span>
    </div>
  )
}
