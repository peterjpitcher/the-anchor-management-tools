'use client'

import { useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
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
  toast,
} from '@/ds'
import { Icon } from '@/ds/icons'
import { usePermissions } from '@/contexts/PermissionContext'
import { createTimeEntry, createMileageEntry, createOneOffCharge, getEntries } from '@/app/actions/oj-projects/entries'
import type { OJClientSummary } from '@/app/actions/oj-projects/clients'
import { formatDateDdMmmmYyyy, getTodayIsoDate } from '@/lib/dateUtils'

function formatCurrency(value: number): string {
  return `£${value.toFixed(2)}`
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

  const [entries, setEntries] = useState(initialEntries)
  const [createOpen, setCreateOpen] = useState(false)
  const [createType, setCreateType] = useState<'time' | 'mileage' | 'one_off'>('time')
  const [saving, setSaving] = useState(false)
  const [createForm, setCreateForm] = useState({
    vendor_id: '',
    project_id: '',
    entry_date: getTodayIsoDate(),
    duration_minutes: '',
    miles: '',
    amount_ex_vat: '',
    work_type_id: '',
    description: '',
    internal_notes: '',
    billable: true,
  })

  const vendors = useMemo(() => {
    const map = new Map<string, string>()
    clients.forEach((client) => map.set(client.id, client.name))
    projects.forEach((p: any) => {
      if (p.vendor?.id && p.vendor?.name) map.set(p.vendor.id, p.vendor.name)
    })
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [clients, projects])

  const addableProjects = useMemo(
    () => projects.filter((p: any) => p.status !== 'completed' && p.status !== 'archived'),
    [projects],
  )

  const createProjectOptions = createForm.vendor_id
    ? addableProjects.filter((p: any) => p.vendor_id === createForm.vendor_id)
    : addableProjects

  function openCreate(): void {
    setCreateForm({
      vendor_id: '',
      project_id: '',
      entry_date: getTodayIsoDate(),
      duration_minutes: '',
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

  const reload = useCallback(async () => {
    const res = await getEntries({ limit: 10 })
    if (res.entries) setEntries(res.entries)
  }, [])

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
        fd.append('duration_minutes', createForm.duration_minutes)
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

  const activeProjects = useMemo(
    () => projects.filter((p) => p.status === 'active'),
    [projects],
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
    const now = new Date()
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    let total = 0
    for (const entry of entries) {
      if (!entry.entry_date?.startsWith(monthKey)) continue
      if (entry.entry_type === 'time') {
        const hours = Number(entry.duration_minutes_rounded || 0) / 60
        const rate = Number(entry.hourly_rate_ex_vat_snapshot || 0)
        total += hours * rate
      } else if (entry.entry_type === 'mileage') {
        total += Number(entry.miles || 0) * Number(entry.mileage_rate_snapshot || 0.42)
      } else if (entry.entry_type === 'one_off') {
        total += Number(entry.amount_ex_vat_snapshot || 0)
      }
    }
    return Math.round(total * 100) / 100
  }, [entries])

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
        {canCreate && (
          <Button variant="primary" icon={<Icon name="plus" size={16} />} onClick={openCreate} className="self-start lg:ml-4">
            New Entry
          </Button>
        )}
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
                <TableHead>Hours Used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeProjects.map((project) => {
                const budgetHours = Number(project.budget_hours || 0)
                const usedHours = Number(project.total_hours_used || 0)
                const budgetMoney = Number(project.budget_ex_vat || 0)
                const spentMoney = Number(project.total_spend_ex_vat || 0)
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
        {entries.length === 0 ? (
          <Empty title="No entries" description="No time entries recorded yet." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Hours/Amount</TableHead>
                <TableHead>Notes</TableHead>
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
                  valueDisplay = formatCurrency(Number(entry.amount_ex_vat_snapshot || 0))
                }

                return (
                  <TableRow key={entry.id}>
                    <TableCell>{formatDateDdMmmmYyyy(entry.entry_date)}</TableCell>
                    <TableCell>{entry.project?.project_name || 'Unknown'}</TableCell>
                    <TableCell>
                      <Badge tone={typeTone}>{entry.entry_type}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{valueDisplay}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-text-muted">
                      {entry.description || '-'}
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
                onChange={(e) => setCreateForm({ ...createForm, entry_date: e.target.value })}
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
              <Field label="Duration (minutes)" required>
                <Input
                  type="number"
                  min="1"
                  value={createForm.duration_minutes}
                  onChange={(e) => setCreateForm({ ...createForm, duration_minutes: e.target.value })}
                  placeholder="e.g. 90"
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
    </div>
  )
}
