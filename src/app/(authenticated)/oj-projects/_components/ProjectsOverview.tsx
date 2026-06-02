'use client'

import { useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Stat,
  Card,
  CardHeader,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
  ProgressBar,
  Empty,
  Button,
  Modal,
  Field,
  Input,
  Textarea,
  Select,
  Checkbox,
  Segmented,
  IconButton,
  toast,
} from '@/ds'
import { Icon } from '@/ds/icons'
import { usePermissions } from '@/contexts/PermissionContext'
import { createTimeEntry, createMileageEntry, createOneOffCharge, getEntries, updateEntry } from '@/app/actions/oj-projects/entries'
import type { OJClientSummary } from '@/app/actions/oj-projects/clients'
import { formatDateDdMmmmYyyy, getTodayIsoDate } from '@/lib/dateUtils'
import { getCurrentMonthEntryDateRange } from '@/lib/oj-projects/date-ranges'
import { getEntryDatePeriod, isProjectSelectableForEntryDate } from '@/lib/oj-projects/retainers'

function formatCurrency(value: number): string {
  return `£${value.toFixed(2)}`
}

function minutesToHoursInput(minutes: unknown): string {
  const value = Number(minutes || 0)
  if (!Number.isFinite(value) || value <= 0) return ''
  const hours = value / 60
  return Number.isInteger(hours) ? String(hours) : String(Number(hours.toFixed(2)))
}

function hoursInputToMinutes(value: string): string {
  const hours = Number(value)
  if (!Number.isFinite(hours)) return ''
  return String(Math.round(hours * 60))
}

interface ProjectsOverviewProps {
  projects: any[]
  entries: any[]
  workTypes: any[]
  clients: OJClientSummary[]
}

export function ProjectsOverview({ projects, entries: initialEntries, workTypes, clients }: ProjectsOverviewProps): React.ReactElement {
  const router = useRouter()
  const { hasPermission } = usePermissions()
  const canCreate = hasPermission('oj_projects', 'create')
  const canEdit = hasPermission('oj_projects', 'edit')

  const [entries, setEntries] = useState(initialEntries)
  const [entriesLoading, setEntriesLoading] = useState(false)
  const [selectedVendorId, setSelectedVendorId] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createType, setCreateType] = useState<'time' | 'mileage' | 'one_off'>('time')
  const [saving, setSaving] = useState(false)
  const [createForm, setCreateForm] = useState({
    vendor_id: '',
    project_id: '',
    entry_date: getTodayIsoDate(),
    duration_hours: '',
    miles: '',
    amount_ex_vat: '',
    work_type_id: '',
    description: '',
    internal_notes: '',
    billable: true,
  })
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({
    id: '',
    entry_type: 'time' as string,
    vendor_id: '',
    project_id: '',
    entry_date: '',
    duration_hours: '',
    miles: '',
    amount_ex_vat: '',
    work_type_id: '',
    description: '',
    internal_notes: '',
    billable: true,
    linked_invoice_id: '',
    linked_invoice_number: '',
    linked_invoice_status: '',
  })

  const vendors = useMemo(() => {
    const map = new Map<string, string>()
    clients.forEach((client) => map.set(client.id, client.name))
    projects.forEach((p: any) => {
      if (p.vendor?.id && p.vendor?.name) map.set(p.vendor.id, p.vendor.name)
    })
    entries.forEach((entry: any) => {
      if (entry.vendor?.id && entry.vendor?.name) map.set(entry.vendor.id, entry.vendor.name)
    })
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [clients, entries, projects])

  const addableProjects = useMemo(
    () => projects.filter((p: any) => p.status !== 'completed' && p.status !== 'archived'),
    [projects],
  )

  function projectMatchesEntryContext(project: any, vendorId: string, entryDate: string): boolean {
    if (vendorId && project.vendor_id !== vendorId) return false
    return isProjectSelectableForEntryDate(project, entryDate)
  }

  function keepProjectForEntryDate(projectId: string, vendorId: string, entryDate: string): string {
    if (!projectId) return ''
    const project = addableProjects.find((item: any) => item.id === projectId)
    return project && projectMatchesEntryContext(project, vendorId, entryDate) ? projectId : ''
  }

  const createProjectOptions = addableProjects.filter((p: any) =>
    projectMatchesEntryContext(p, createForm.vendor_id, createForm.entry_date),
  )

  const editProjectOptions = addableProjects.filter((p: any) =>
    projectMatchesEntryContext(p, editForm.vendor_id, editForm.entry_date),
  )

  function openCreate(): void {
    setCreateForm({
      vendor_id: selectedVendorId,
      project_id: '',
      entry_date: getTodayIsoDate(),
      duration_hours: '',
      miles: '',
      amount_ex_vat: '',
      work_type_id: '',
      description: '',
      internal_notes: '',
      billable: true,
    })
    setCreateType('time')
    setCreateOpen(true)
  }

  function openEdit(entry: any): void {
    if (!isEntryEditable(entry)) {
      toast.error('Only unbilled or unpaid invoiced entries can be edited')
      return
    }

    setEditForm({
      id: entry.id,
      entry_type: entry.entry_type,
      vendor_id: entry.vendor_id,
      project_id: entry.project && !isProjectSelectableForEntryDate(entry.project, entry.entry_date) ? '' : entry.project_id,
      entry_date: entry.entry_date,
      duration_hours: minutesToHoursInput(entry.duration_minutes_raw ?? entry.duration_minutes_rounded),
      miles: entry.miles != null ? String(entry.miles) : '',
      amount_ex_vat: entry.amount_ex_vat_snapshot != null ? String(entry.amount_ex_vat_snapshot) : '',
      work_type_id: entry.work_type_id || '',
      description: entry.description || '',
      internal_notes: entry.internal_notes || '',
      billable: entry.billable ?? true,
      linked_invoice_id: entry.invoice?.id || '',
      linked_invoice_number: entry.invoice?.invoice_number || '',
      linked_invoice_status: entry.invoice?.status || '',
    })
    setEditOpen(true)
  }

  const loadEntriesForClient = useCallback(async (vendorId: string) => {
    setEntriesLoading(true)
    setEntries([])
    try {
      const currentMonthRange = getCurrentMonthEntryDateRange()
      const res = await getEntries({
        ...currentMonthRange,
        ...(vendorId ? { vendorId } : {}),
      })
      if (res.error) throw new Error(res.error)
      if (res.entries) setEntries(res.entries)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load entries')
    } finally {
      setEntriesLoading(false)
    }
  }, [])

  const reload = useCallback(async () => {
    await loadEntriesForClient(selectedVendorId)
  }, [loadEntriesForClient, selectedVendorId])

  function handleClientFilterChange(vendorId: string): void {
    setSelectedVendorId(vendorId)
    void loadEntriesForClient(vendorId)
  }

  async function handleCreateSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setSaving(true)
    try {
      const fd = new FormData()
      fd.append('vendor_id', createForm.vendor_id)
      fd.append('project_id', createForm.project_id)
      fd.append('entry_date', createForm.entry_date)
      fd.append('description', createForm.description)
      fd.append('internal_notes', createForm.internal_notes)
      fd.append('billable', String(createForm.billable))

      let res: any
      if (createType === 'time') {
        fd.append('duration_minutes', hoursInputToMinutes(createForm.duration_hours))
        if (createForm.work_type_id) fd.append('work_type_id', createForm.work_type_id)
        res = await createTimeEntry(fd)
      } else if (createType === 'mileage') {
        fd.append('miles', createForm.miles)
        res = await createMileageEntry(fd)
      } else {
        fd.append('amount_ex_vat', createForm.amount_ex_vat)
        res = await createOneOffCharge(fd)
      }

      if (res.error) throw new Error(res.error)
      toast.success('Entry created')
      setCreateOpen(false)
      await reload()
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create entry')
    } finally {
      setSaving(false)
    }
  }

  async function handleEditSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setSaving(true)
    try {
      const fd = new FormData()
      fd.append('id', editForm.id)
      fd.append('entry_type', editForm.entry_type)
      fd.append('vendor_id', editForm.vendor_id)
      fd.append('project_id', editForm.project_id)
      fd.append('entry_date', editForm.entry_date)
      fd.append('description', editForm.description)
      fd.append('internal_notes', editForm.internal_notes)
      fd.append('billable', String(editForm.billable))

      if (editForm.entry_type === 'time') {
        fd.append('duration_minutes', hoursInputToMinutes(editForm.duration_hours))
        fd.append('work_type_id', editForm.work_type_id)
      } else if (editForm.entry_type === 'mileage') {
        fd.append('miles', editForm.miles)
      } else {
        fd.append('amount_ex_vat', editForm.amount_ex_vat)
      }

      const res = await updateEntry(fd)
      if ('error' in res && res.error) throw new Error(res.error)
      const invoiceRevision = 'invoiceRevision' in res ? res.invoiceRevision : undefined
      toast.success(
        invoiceRevision
          ? invoiceRevision.mode === 'replacement'
            ? `Entry updated; ${invoiceRevision.voided_invoice_number} voided and draft ${invoiceRevision.invoice_number} created`
            : `Entry updated; ${invoiceRevision.invoice_number} recalculated`
          : 'Entry updated'
      )
      setEditOpen(false)
      await reload()
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update entry')
    } finally {
      setSaving(false)
    }
  }

  const visibleProjects = useMemo(
    () => selectedVendorId ? projects.filter((p) => p.vendor_id === selectedVendorId) : projects,
    [projects, selectedVendorId],
  )

  const currentPeriod = getEntryDatePeriod(getTodayIsoDate())

  const activeProjects = useMemo(
    () => visibleProjects.filter((p) => {
      if (p.status !== 'active') return false
      if (!p.is_retainer) return true
      return p.retainer_period_yyyymm === currentPeriod
    }),
    [currentPeriod, visibleProjects],
  )

  const totalHours = useMemo(() => {
    let hours = 0
    for (const entry of entries) {
      if (entry.entry_type === 'time') {
        hours += Number(entry.duration_minutes_rounded || 0) / 60
      }
    }
    return Math.round(hours * 100) / 100
  }, [entries])

  const revenueThisMonth = useMemo(() => {
    let total = 0
    for (const project of visibleProjects) {
      total += Number(project.billed_this_month_ex_vat || 0)
    }
    return Math.round(total * 100) / 100
  }, [visibleProjects])

  const outstandingCount = useMemo(
    () => entries.filter((e) => e.status === 'unbilled').length,
    [entries],
  )

  const statusTone = (status: string): 'success' | 'warning' | 'info' | 'neutral' => {
    switch (status) {
      case 'active': return 'success'
      case 'paused': return 'warning'
      case 'completed': return 'info'
      default: return 'neutral'
    }
  }

  const entryStatusTone = (status: string): 'success' | 'warning' | 'info' | 'neutral' => {
    switch (status) {
      case 'paid': return 'success'
      case 'billed': return 'info'
      case 'unbilled': return 'warning'
      default: return 'neutral'
    }
  }

  function isEntryEditable(entry: any): boolean {
    if (entry.status === 'unbilled') return true
    if (!['billed', 'billing_pending'].includes(String(entry.status))) return false
    if (!entry.invoice_id || !entry.invoice) return false
    const invoiceStatus = String(entry.invoice.status || '')
    if (['paid', 'partially_paid', 'void', 'written_off'].includes(invoiceStatus)) return false
    return true
  }

  function entryAmount(entry: any): number {
    if (entry.entry_type === 'time') {
      return (Number(entry.duration_minutes_rounded || 0) / 60) * Number(entry.hourly_rate_ex_vat_snapshot || 0)
    }
    if (entry.entry_type === 'mileage') {
      return Number(entry.miles || 0) * Number(entry.mileage_rate_snapshot || 0.55)
    }
    return Number(entry.amount_ex_vat_snapshot || 0)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        {/* Stats row */}
        <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Active Projects" value={String(activeProjects.length)} icon={<Icon name="briefcase" size={20} />} />
          <Stat label="Total Hours" value={totalHours.toFixed(1)} icon={<Icon name="clock" size={20} />} />
          <Stat label="Revenue This Month" value={formatCurrency(revenueThisMonth)} icon={<Icon name="pound" size={20} />} />
          <Stat label="Unbilled Entries" value={String(outstandingCount)} icon={<Icon name="clock" size={20} />} />
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-end lg:ml-4">
          <Select
            label="Client"
            value={selectedVendorId}
            onChange={(e) => handleClientFilterChange(e.target.value)}
            options={[
              { label: 'All clients', value: '' },
              ...vendors.map((v) => ({ label: v.name, value: v.id })),
            ]}
            className="min-w-[220px]"
          />
          {canCreate && (
            <Button variant="primary" icon={<Icon name="plus" size={16} />} onClick={openCreate} className="self-start sm:self-auto">
              New Entry
            </Button>
          )}
        </div>
      </div>

      {/* Recent Projects */}
      <Card>
        <CardHeader title="Active Projects" />
        {activeProjects.length === 0 ? (
          <Empty title="No active projects" description="No projects are currently active." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Budget</TableHead>
                <TableHead>Billed This Month</TableHead>
                <TableHead>Hours Used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeProjects.map((project) => {
                const budgetHours = Number(project.budget_hours || 0)
                const usedHours = Number(project.total_hours_used || 0)
                const budgetMoney = Number(project.budget_ex_vat || 0)
                const spentMoney = Number(project.total_spend_ex_vat || 0)
                const billedThisMonth = Number(project.billed_this_month_ex_vat || 0)
                const hasBudget = budgetHours > 0 || budgetMoney > 0
                const progress = budgetHours > 0
                  ? Math.min((usedHours / budgetHours) * 100, 100)
                  : budgetMoney > 0
                    ? Math.min((spentMoney / budgetMoney) * 100, 100)
                    : 0

                return (
                  <TableRow
                    key={project.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/oj-projects/projects/${project.id}`)}
                  >
                    <TableCell className="font-medium">{project.project_name}</TableCell>
                    <TableCell>{project.vendor?.name || 'Unknown'}</TableCell>
                    <TableCell>
                      <Badge tone={statusTone(project.status)}>{project.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {hasBudget ? (
                        <div className="flex flex-col gap-1 min-w-[140px]">
                          <ProgressBar
                            value={progress}
                            tone={progress > 90 ? 'danger' : 'primary'}
                          />
                          <span className="text-xs text-text-muted">
                            {budgetHours > 0
                              ? `${usedHours.toFixed(1)}h / ${budgetHours.toFixed(1)}h`
                              : `${formatCurrency(spentMoney)} / ${formatCurrency(budgetMoney)}`}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-text-muted italic">No budget</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{formatCurrency(billedThisMonth)}</TableCell>
                    <TableCell>{usedHours.toFixed(1)}h</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Recent Entries */}
      <Card>
        <CardHeader title="Recent Entries" />
        {entriesLoading ? (
          <Empty title="Loading entries" />
        ) : entries.length === 0 ? (
          <Empty
            title="No entries"
            description={selectedVendorId ? 'No entries found for this client.' : 'No time entries recorded yet.'}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Hours/Qty</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                const typeTone = entry.entry_type === 'time' ? 'info' : entry.entry_type === 'mileage' ? 'warning' : 'neutral'
                let valueDisplay = ''
                if (entry.entry_type === 'time') {
                  valueDisplay = `${(Number(entry.duration_minutes_rounded || 0) / 60).toFixed(1)}h`
                } else if (entry.entry_type === 'mileage') {
                  valueDisplay = `${entry.miles} mi`
                } else {
                  valueDisplay = '-'
                }

                return (
                  <TableRow key={entry.id}>
                    <TableCell>{formatDateDdMmmmYyyy(entry.entry_date)}</TableCell>
                    <TableCell>{entry.project?.project_name || 'Unknown'}</TableCell>
                    <TableCell>
                      <Badge tone={typeTone}>{entry.entry_type}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{valueDisplay}</TableCell>
                    <TableCell className="font-medium">{formatCurrency(entryAmount(entry))}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-text-muted">
                      {entry.description || '-'}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge tone={entryStatusTone(entry.status)}>{entry.status}</Badge>
                        {entry.invoice?.invoice_number && (
                          <Link href={`/invoices/${entry.invoice.id}`} className="text-xs text-primary hover:underline">
                            {entry.invoice.invoice_number}
                          </Link>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {isEntryEditable(entry) && canEdit && (
                        <IconButton
                          icon={<Icon name="edit" size={16} />}
                          size="sm"
                          label={entry.status === 'unbilled' ? 'Edit entry' : 'Edit and revise invoice'}
                          onClick={() => openEdit(entry)}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Create Entry Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Entry">
        <form onSubmit={handleCreateSubmit} className="flex flex-col gap-4">
          <Segmented
            options={[
              { id: 'time', label: 'Time' },
              { id: 'mileage', label: 'Mileage' },
              { id: 'one_off', label: 'One-off' },
            ]}
            value={createType}
            onChange={(id) => setCreateType(id as 'time' | 'mileage' | 'one_off')}
            size="sm"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Client" required>
              <Select
                value={createForm.vendor_id}
                onChange={(e) => setCreateForm({ ...createForm, vendor_id: e.target.value, project_id: '' })}
                required
                options={[
                  { label: 'Select client...', value: '' },
                  ...vendors.map((v) => ({ label: v.name, value: v.id })),
                ]}
              />
            </Field>
            <Field label="Date" required>
              <Input
                type="date"
                value={createForm.entry_date}
                onChange={(e) => {
                  const entryDate = e.target.value
                  setCreateForm({
                    ...createForm,
                    entry_date: entryDate,
                    project_id: keepProjectForEntryDate(createForm.project_id, createForm.vendor_id, entryDate),
                  })
                }}
                required
              />
            </Field>
          </div>
          <Field label="Project">
            <Select
              value={createForm.project_id}
              onChange={(e) => setCreateForm({ ...createForm, project_id: e.target.value })}
              options={[
                { label: 'Current retainer / General Work', value: '' },
                ...createProjectOptions.map((p: any) => ({
                  label: `${p.project_code} - ${p.project_name}${p.status === 'paused' ? ' (paused)' : ''}`,
                  value: p.id,
                })),
              ]}
            />
          </Field>
          {createType === 'time' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Duration (hours)" required>
                <Input
                  type="number"
                  min="0.25"
                  step="0.25"
                  value={createForm.duration_hours}
                  onChange={(e) => setCreateForm({ ...createForm, duration_hours: e.target.value })}
                  placeholder="e.g. 1.5"
                  required
                />
              </Field>
              <Field label="Work Type">
                <Select
                  value={createForm.work_type_id}
                  onChange={(e) => setCreateForm({ ...createForm, work_type_id: e.target.value })}
                  options={[
                    { label: 'None', value: '' },
                    ...workTypes.filter((w: any) => w.is_active).map((w: any) => ({
                      label: w.name,
                      value: w.id,
                    })),
                  ]}
                />
              </Field>
            </div>
          )}
          {createType === 'mileage' && (
            <Field label="Miles" required>
              <Input
                type="number"
                min="0.1"
                step="0.1"
                value={createForm.miles}
                onChange={(e) => setCreateForm({ ...createForm, miles: e.target.value })}
                placeholder="e.g. 12.5"
                required
              />
            </Field>
          )}
          {createType === 'one_off' && (
            <Field label="Amount (ex VAT)" required>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={createForm.amount_ex_vat}
                onChange={(e) => setCreateForm({ ...createForm, amount_ex_vat: e.target.value })}
                placeholder="e.g. 150.00"
                required
              />
            </Field>
          )}
          <Field label="Description">
            <Input
              value={createForm.description}
              onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
              placeholder="What was done..."
            />
          </Field>
          <Field label="Internal Notes">
            <Textarea
              value={createForm.internal_notes}
              onChange={(e) => setCreateForm({ ...createForm, internal_notes: e.target.value })}
              rows={2}
            />
          </Field>
          <Checkbox
            label="Billable"
            checked={createForm.billable}
            onChange={(checked) => setCreateForm({ ...createForm, billable: checked })}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Create Entry
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Entry Modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Entry">
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Entry Type">
              <Input value={editForm.entry_type} disabled />
            </Field>
            <Field label="Date" required>
              <Input
                type="date"
                value={editForm.entry_date}
                onChange={(e) => {
                  const entryDate = e.target.value
                  setEditForm({
                    ...editForm,
                    entry_date: entryDate,
                    project_id: keepProjectForEntryDate(editForm.project_id, editForm.vendor_id, entryDate),
                  })
                }}
                required
              />
            </Field>
          </div>

          {editForm.linked_invoice_number && (
            <Field label="Invoice">
              <Input
                value={`${editForm.linked_invoice_number}${editForm.linked_invoice_status ? ` (${editForm.linked_invoice_status})` : ''}`}
                disabled
              />
            </Field>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Client" required>
              <Select
                value={editForm.vendor_id}
                onChange={(e) => setEditForm({ ...editForm, vendor_id: e.target.value, project_id: '' })}
                required
                options={[
                  { label: 'Select client...', value: '' },
                  ...vendors.map((v) => ({ label: v.name, value: v.id })),
                ]}
              />
            </Field>
            <Field label="Project">
              <Select
                value={editForm.project_id}
                onChange={(e) => setEditForm({ ...editForm, project_id: e.target.value })}
                options={[
                  { label: 'Current retainer / General Work', value: '' },
                  ...editProjectOptions.map((p: any) => ({
                    label: `${p.project_code} - ${p.project_name}${p.status === 'paused' ? ' (paused)' : ''}`,
                    value: p.id,
                  })),
                ]}
              />
            </Field>
          </div>

          {editForm.entry_type === 'time' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Duration (hours)" required>
                <Input
                  type="number"
                  min="0.25"
                  step="0.25"
                  value={editForm.duration_hours}
                  onChange={(e) => setEditForm({ ...editForm, duration_hours: e.target.value })}
                  required
                />
              </Field>
              <Field label="Work Type">
                <Select
                  value={editForm.work_type_id}
                  onChange={(e) => setEditForm({ ...editForm, work_type_id: e.target.value })}
                  options={[
                    { label: 'None', value: '' },
                    ...workTypes.filter((w: any) => w.is_active).map((w: any) => ({
                      label: w.name,
                      value: w.id,
                    })),
                  ]}
                />
              </Field>
            </div>
          )}

          {editForm.entry_type === 'mileage' && (
            <Field label="Miles" required>
              <Input
                type="number"
                min="0.1"
                step="0.1"
                value={editForm.miles}
                onChange={(e) => setEditForm({ ...editForm, miles: e.target.value })}
                required
              />
            </Field>
          )}

          {editForm.entry_type === 'one_off' && (
            <Field label="Amount (ex VAT)" required>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={editForm.amount_ex_vat}
                onChange={(e) => setEditForm({ ...editForm, amount_ex_vat: e.target.value })}
                required
              />
            </Field>
          )}

          <Field label="Description">
            <Input
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
            />
          </Field>
          <Field label="Internal Notes">
            <Textarea
              value={editForm.internal_notes}
              onChange={(e) => setEditForm({ ...editForm, internal_notes: e.target.value })}
              rows={2}
            />
          </Field>
          <Checkbox
            label="Billable"
            checked={editForm.billable}
            onChange={(checked) => setEditForm({ ...editForm, billable: checked })}
          />

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editForm.linked_invoice_number
                ? editForm.linked_invoice_status === 'draft'
                  ? 'Save and Recalculate Draft'
                  : 'Save and Create Replacement Draft'
                : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
