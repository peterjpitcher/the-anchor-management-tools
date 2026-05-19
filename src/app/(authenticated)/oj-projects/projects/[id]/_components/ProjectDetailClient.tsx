'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card,
  CardHeader,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
  Button,
  ProgressBar,
  Empty,
  ConfirmDialog,
  Select,
  IconButton,
  toast,
} from '@/ds'
import { Icon } from '@/ds/icons'
import { usePermissions } from '@/contexts/PermissionContext'
import { updateProjectStatus, deleteProject } from '@/app/actions/oj-projects/projects'
import { deleteEntry } from '@/app/actions/oj-projects/entries'
import { removeProjectContact } from '@/app/actions/oj-projects/project-contacts'
import { formatDateDdMmmmYyyy } from '@/lib/dateUtils'

function formatCurrency(value: number): string {
  return `£${value.toFixed(2)}`
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

interface ProjectDetailClientProps {
  project: any
  entries: any[]
  contacts: any[]
  payments: any | null
}

export function ProjectDetailClient({
  project,
  entries,
  contacts,
  payments,
}: ProjectDetailClientProps): React.ReactElement {
  const router = useRouter()
  const { hasPermission } = usePermissions()
  const canEdit = hasPermission('oj_projects', 'edit')
  const canDelete = hasPermission('oj_projects', 'delete')

  const [deleteEntryId, setDeleteEntryId] = useState<string | null>(null)
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false)

  const totals = useMemo(() => {
    const t = { hours: 0, totalExVat: 0, unbilled: 0, billed: 0, paid: 0 }
    for (const entry of entries) {
      if (!entry?.billable) continue
      let exVat = 0
      if (entry.entry_type === 'time') {
        const hours = Number(entry.duration_minutes_rounded || 0) / 60
        const rate = Number(entry.hourly_rate_ex_vat_snapshot || 0)
        exVat = hours * rate
        t.hours += hours
      } else if (entry.entry_type === 'mileage') {
        exVat = Number(entry.miles || 0) * Number(entry.mileage_rate_snapshot || 0.42)
      } else if (entry.entry_type === 'one_off') {
        exVat = Number(entry.amount_ex_vat_snapshot || 0)
      }
      exVat = roundCurrency(exVat)
      t.totalExVat += exVat
      if (entry.status === 'paid') t.paid += exVat
      else if (entry.status === 'billed') t.billed += exVat
      else t.unbilled += exVat
    }
    return {
      hours: roundCurrency(t.hours),
      totalExVat: roundCurrency(t.totalExVat),
      unbilled: roundCurrency(t.unbilled),
      billed: roundCurrency(t.billed),
      paid: roundCurrency(t.paid),
    }
  }, [entries])

  const budget = project?.budget_ex_vat != null ? Number(project.budget_ex_vat) : null
  const budgetHours = project?.budget_hours != null ? Number(project.budget_hours) : null
  const budgetProgress = budget && budget > 0 ? Math.min((totals.totalExVat / budget) * 100, 100) : 0
  const hoursProgress = budgetHours && budgetHours > 0 ? Math.min((totals.hours / budgetHours) * 100, 100) : 0

  const taggedContacts = useMemo(() => {
    return Array.isArray(contacts) ? contacts : (Array.isArray(project?.contacts) ? project.contacts : [])
  }, [contacts, project])

  async function handleStatusChange(newStatus: string): Promise<void> {
    const fd = new FormData()
    fd.append('id', project.id)
    fd.append('status', newStatus)
    const res = await updateProjectStatus(fd)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success(`Project ${newStatus}`)
      router.refresh()
    }
  }

  async function handleDeleteEntry(): Promise<void> {
    if (!deleteEntryId) return
    const fd = new FormData()
    fd.append('id', deleteEntryId)
    const res = await deleteEntry(fd)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Entry deleted')
      setDeleteEntryId(null)
      router.refresh()
    }
  }

  async function handleDeleteProject(): Promise<void> {
    const fd = new FormData()
    fd.append('id', project.id)
    const res = await deleteProject(fd)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Project deleted')
      router.push('/oj-projects/projects')
    }
  }

  async function handleRemoveContact(contactRowId: string): Promise<void> {
    const fd = new FormData()
    fd.append('id', contactRowId)
    const res = await removeProjectContact(fd)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Contact removed')
      router.refresh()
    }
  }

  const statusTone = (status: string): 'success' | 'warning' | 'info' | 'neutral' => {
    switch (status) {
      case 'active': return 'success'
      case 'paused': return 'warning'
      case 'completed': return 'info'
      default: return 'neutral'
    }
  }

  const statusOptions = [
    { label: 'Active', value: 'active' },
    { label: 'Paused', value: 'paused' },
    { label: 'Completed', value: 'completed' },
    { label: 'Archived', value: 'archived' },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb-style back link */}
      <Button
        variant="ghost"
        size="sm"
        icon={<Icon name="chevronLeft" size={16} />}
        onClick={() => router.push('/oj-projects/projects')}
      >
        Back to Projects
      </Button>

      {/* Title row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-text">{project.project_name}</h2>
          <p className="text-sm text-text-muted">{project.project_code} &middot; {project.vendor?.name || 'Unknown Client'}</p>
        </div>
        <div className="flex gap-2">
          {canEdit && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => router.push(`/oj-projects/projects?edit=${project.id}`)}
            >
              Edit Project
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteProjectOpen(true)}
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main column */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Budget Card */}
          <Card>
            <CardHeader title="Budget" />
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <p className="text-xs text-text-muted">Total (ex VAT)</p>
                <p className="text-lg font-semibold">{formatCurrency(totals.totalExVat)}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted">Hours Logged</p>
                <p className="text-lg font-semibold">{totals.hours.toFixed(1)}h</p>
              </div>
              <div>
                <p className="text-xs text-text-muted">Budget</p>
                <p className="text-lg font-semibold">{budget != null ? formatCurrency(budget) : 'Not set'}</p>
              </div>
            </div>
            {budget != null && budget > 0 && (
              <div className="mb-4">
                <ProgressBar
                  value={budgetProgress}
                  tone={budgetProgress > 90 ? 'danger' : 'primary'}
                />
                <p className="text-xs text-text-muted mt-1">
                  {formatCurrency(totals.totalExVat)} of {formatCurrency(budget)} used
                </p>
              </div>
            )}
            {budgetHours != null && budgetHours > 0 && (
              <div className="mb-4">
                <ProgressBar
                  value={hoursProgress}
                  tone={hoursProgress > 90 ? 'danger' : 'primary'}
                />
                <p className="text-xs text-text-muted mt-1">
                  {totals.hours.toFixed(1)}h of {budgetHours.toFixed(1)}h used
                </p>
              </div>
            )}
            <div className="grid grid-cols-3 gap-4 border-t border-border pt-4">
              <div>
                <p className="text-xs text-text-muted">Unbilled</p>
                <p className="font-medium">{formatCurrency(totals.unbilled)}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted">Billed</p>
                <p className="font-medium text-info">{formatCurrency(totals.billed)}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted">Paid</p>
                <p className="font-medium text-success">{formatCurrency(totals.paid)}</p>
              </div>
            </div>
          </Card>

          {/* Entries Table */}
          <Card>
            <CardHeader title={`Entries (${entries.length})`} />
            {entries.length === 0 ? (
              <Empty title="No entries" description="No entries recorded yet." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => {
                    let amount = 0
                    if (entry.entry_type === 'time') {
                      amount = (Number(entry.duration_minutes_rounded || 0) / 60) * Number(entry.hourly_rate_ex_vat_snapshot || 0)
                    } else if (entry.entry_type === 'mileage') {
                      amount = Number(entry.miles || 0) * Number(entry.mileage_rate_snapshot || 0.42)
                    } else {
                      amount = Number(entry.amount_ex_vat_snapshot || 0)
                    }

                    const typeTone = entry.entry_type === 'time' ? 'info' : entry.entry_type === 'mileage' ? 'warning' : 'neutral'
                    const statusEntryTone = entry.status === 'paid' ? 'success' : entry.status === 'billed' ? 'info' : 'warning'

                    return (
                      <TableRow key={entry.id}>
                        <TableCell>{formatDateDdMmmmYyyy(entry.entry_date)}</TableCell>
                        <TableCell><Badge tone={typeTone}>{entry.entry_type}</Badge></TableCell>
                        <TableCell>
                          {entry.entry_type === 'time'
                            ? `${(Number(entry.duration_minutes_rounded || 0) / 60).toFixed(1)}h`
                            : entry.entry_type === 'mileage'
                              ? `${entry.miles} mi`
                              : '-'}
                        </TableCell>
                        <TableCell className="font-medium">{formatCurrency(amount)}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-text-muted">
                          {entry.description || '-'}
                        </TableCell>
                        <TableCell><Badge tone={statusEntryTone}>{entry.status}</Badge></TableCell>
                        <TableCell>
                          {entry.status === 'unbilled' && canDelete && (
                            <IconButton
                              icon={<Icon name="trash" size={16} />}
                              size="sm"
                              label="Delete"
                              onClick={() => setDeleteEntryId(entry.id)}
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
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-6">
          {/* Status Card */}
          <Card>
            <CardHeader title="Status" />
            <div className="flex flex-col gap-3">
              <Badge tone={statusTone(project.status)}>{project.status}</Badge>
              {canEdit && (
                <Select
                  value={project.status}
                  onChange={(e) => handleStatusChange(e.target.value)}
                  options={statusOptions}
                />
              )}
            </div>
          </Card>

          {/* Contacts Card */}
          <Card>
            <CardHeader title="Contacts" />
            {taggedContacts.length === 0 ? (
              <p className="text-sm text-text-muted">No contacts tagged.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {taggedContacts.map((tc: any) => (
                  <div key={tc.id} className="flex items-start justify-between gap-2 p-2 rounded-lg bg-surface-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{tc.contact?.name || 'Unknown'}</p>
                      <p className="text-xs text-text-muted truncate">{tc.contact?.email || ''}</p>
                    </div>
                    {canEdit && (
                      <IconButton
                        icon={<Icon name="trash" size={16} />}
                        size="sm"
                        label="Remove"
                        onClick={() => handleRemoveContact(tc.id)}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Payment History */}
          {payments && payments.invoices && payments.invoices.length > 0 && (
            <Card>
              <CardHeader title="Payment History" />
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div>
                  <p className="text-xs text-text-muted">Billed</p>
                  <p className="text-sm font-semibold">{formatCurrency(payments.totals.totalBilled)}</p>
                </div>
                <div>
                  <p className="text-xs text-text-muted">Paid</p>
                  <p className="text-sm font-semibold text-success">{formatCurrency(payments.totals.totalPaid)}</p>
                </div>
                <div>
                  <p className="text-xs text-text-muted">Outstanding</p>
                  <p className={`text-sm font-semibold ${payments.totals.totalOutstanding > 0 ? 'text-danger' : 'text-success'}`}>
                    {formatCurrency(payments.totals.totalOutstanding)}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {payments.invoices.map((item: any) => (
                  <div key={item.invoice.id} className="flex items-center justify-between text-sm p-2 rounded-lg bg-surface-2">
                    <div>
                      <p className="font-medium">{item.invoice.number}</p>
                      <p className="text-xs text-text-muted">{item.invoice.date ? formatDateDdMmmmYyyy(item.invoice.date) : '-'}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">{formatCurrency(item.invoice.total)}</p>
                      <Badge tone={item.invoice.status === 'paid' ? 'success' : 'warning'}>
                        {item.invoice.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={!!deleteEntryId}
        onClose={() => setDeleteEntryId(null)}
        onConfirm={handleDeleteEntry}
        title="Delete Entry"
        message="Are you sure you want to delete this entry? This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
      />
      <ConfirmDialog
        open={deleteProjectOpen}
        onClose={() => setDeleteProjectOpen(false)}
        onConfirm={handleDeleteProject}
        title="Delete Project"
        message="Are you sure? You can only delete projects with no entries."
        confirmLabel="Delete"
        tone="danger"
      />
    </div>
  )
}
