'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Card,
  CardHeader,
  CardBody,
  DescriptionList,
  PageLayout,
  Stat,
  StatGrid,
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
  RowActions,
  toast,
} from '@/ds'
import { Icon } from '@/ds/icons'
import { usePermissions } from '@/contexts/PermissionContext'
import { updateProjectStatus, deleteProject } from '@/app/actions/oj-projects/projects'
import { deleteEntry } from '@/app/actions/oj-projects/entries'
import { removeProjectContact } from '@/app/actions/oj-projects/project-contacts'
import { formatDateDdMmmmYyyy } from '@/lib/dateUtils'
import { DEFAULT_HOURLY_RATE_EX_VAT, DEFAULT_MILEAGE_RATE, resolveRate } from '@/lib/oj-projects/rates'
import { invoiceStatusLabel, invoiceStatusTone } from '@/lib/invoices/status-ui'
import { ojProjectDetailLayout } from '../../../_shared/nav'
import {
  OJ_MONEY_TEXT,
  ojBalanceText,
  ojBudgetTone,
  ojEntryStatus,
  ojEntryType,
  ojProjectStatus,
  ojReceivedTone,
} from '../../../_shared/status-ui'

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
  /** Set when the entries failed to load, so the page says so rather than showing none. */
  entriesError?: string
  /** Set when the tagged contacts failed to load. */
  contactsError?: string
}

export function ProjectDetailClient({
  project,
  entries,
  contacts,
  payments,
  entriesError,
  contactsError,
}: ProjectDetailClientProps): React.ReactElement {
  const router = useRouter()
  const { hasPermission } = usePermissions()
  const canEdit = hasPermission('oj_projects', 'edit')
  const canDelete = hasPermission('oj_projects', 'delete')

  const [deleteEntryId, setDeleteEntryId] = useState<string | null>(null)
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false)
  // The tagged contact waiting on the Remove confirm. There is no way to tag a contact back from
  // this page, so removing one is confirmed first, as every danger action is.
  const [removeContact, setRemoveContact] = useState<{ id: string; name: string } | null>(null)

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
        exVat = Number(entry.miles || 0) * resolveRate(entry.mileage_rate_snapshot, DEFAULT_MILEAGE_RATE)
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

  const statusOptions = [
    { label: 'Active', value: 'active' },
    { label: 'Paused', value: 'paused' },
    { label: 'Completed', value: 'completed' },
    { label: 'Archived', value: 'archived' },
  ]

  const projectStatus = ojProjectStatus(project.status)

  return (
    <PageLayout
      {...ojProjectDetailLayout(
        project.project_name,
        `${project.project_code} · ${project.vendor?.name || 'Unknown Client'}`,
      )}
      headerActions={
        canEdit || canDelete ? (
          <>
            {canEdit && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => router.push(`/oj-projects/projects?edit=${project.id}`)}
              >
                Edit
              </Button>
            )}
            {canDelete && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setDeleteProjectOpen(true)}
              >
                Delete
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-6">
          <StatGrid columns={3}>
            <Stat label="Total (ex VAT)" value={formatCurrency(totals.totalExVat)} />
            <Stat label="Hours Logged" value={`${totals.hours.toFixed(1)}h`} />
            <Stat label="Budget" value={budget != null ? formatCurrency(budget) : 'Not set'} />
          </StatGrid>

          {((budget != null && budget > 0) || (budgetHours != null && budgetHours > 0)) && (
            <Card>
              <CardHeader title="Budget Used" />
              <CardBody className="space-y-4">
                {budget != null && budget > 0 && (
                  <div>
                    <ProgressBar value={budgetProgress} tone={ojBudgetTone(budgetProgress)} />
                    <p className="text-xs text-text-muted mt-1">
                      {formatCurrency(totals.totalExVat)} of {formatCurrency(budget)} used
                    </p>
                  </div>
                )}
                {budgetHours != null && budgetHours > 0 && (
                  <div>
                    <ProgressBar value={hoursProgress} tone={ojBudgetTone(hoursProgress)} />
                    <p className="text-xs text-text-muted mt-1">
                      {totals.hours.toFixed(1)}h of {budgetHours.toFixed(1)}h used
                    </p>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          <StatGrid columns={3}>
            <Stat label="Unbilled" value={formatCurrency(totals.unbilled)} />
            <Stat label="Billed" value={formatCurrency(totals.billed)} />
            <Stat label="Paid" value={formatCurrency(totals.paid)} tone={ojReceivedTone(totals.paid)} />
          </StatGrid>

          {/* Entries Table */}
          <Card>
            <CardHeader title={`Entries (${entries.length})`} />
            {entriesError ? (
              <CardBody>
                <Alert tone="danger" title="Could not load the entries">
                  {entriesError}
                </Alert>
              </CardBody>
            ) : entries.length === 0 ? (
              <Empty size="sm" title="No entries yet" description="Entries logged against this project show here." />
            ) : (
              <>
                <div className="divide-y divide-border px-pad-card py-3 md:hidden">
                  {entries.map((entry) => {
                    const amount = entry.entry_type === 'time'
                      ? (Number(entry.duration_minutes_rounded || 0) / 60) * Number(entry.hourly_rate_ex_vat_snapshot || 0)
                      : entry.entry_type === 'mileage'
                        ? Number(entry.miles || 0) * resolveRate(entry.mileage_rate_snapshot, DEFAULT_MILEAGE_RATE)
                        : Number(entry.amount_ex_vat_snapshot || 0)
                    const entryType = ojEntryType(entry.entry_type)
                    const entryStatus = ojEntryStatus(entry.status)
                    const value = entry.entry_type === 'time'
                      ? `${(Number(entry.duration_minutes_rounded || 0) / 60).toFixed(1)}h`
                      : entry.entry_type === 'mileage'
                        ? `${entry.miles} mi`
                        : null

                    return (
                      <div key={entry.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-text">{formatDateDdMmmmYyyy(entry.entry_date)}</p>
                            {entry.description && (
                              <p className="text-sm text-text-muted [overflow-wrap:anywhere]">{entry.description}</p>
                            )}
                          </div>
                          {entry.status === 'unbilled' && canDelete && (
                            <RowActions
                              actions={[
                                {
                                  key: 'delete',
                                  label: 'Delete',
                                  icon: <Icon name="trash" size={16} />,
                                  tone: 'danger',
                                  onSelect: () => setDeleteEntryId(entry.id),
                                },
                              ]}
                            />
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <Badge tone={entryType.tone}>{entryType.label}</Badge>
                          {value && <span className="text-text-muted">{value}</span>}
                          <span className="font-medium">{formatCurrency(amount)}</span>
                          <Badge tone={entryStatus.tone}>{entryStatus.label}</Badge>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <Table className="hidden md:block">
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
                      amount = Number(entry.miles || 0) * resolveRate(entry.mileage_rate_snapshot, DEFAULT_MILEAGE_RATE)
                    } else {
                      amount = Number(entry.amount_ex_vat_snapshot || 0)
                    }

                    const entryType = ojEntryType(entry.entry_type)
                    const entryStatus = ojEntryStatus(entry.status)

                    return (
                      <TableRow key={entry.id}>
                        <TableCell>{formatDateDdMmmmYyyy(entry.entry_date)}</TableCell>
                        <TableCell><Badge tone={entryType.tone}>{entryType.label}</Badge></TableCell>
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
                        <TableCell><Badge tone={entryStatus.tone}>{entryStatus.label}</Badge></TableCell>
                        <TableCell>
                          {entry.status === 'unbilled' && canDelete && (
                            <RowActions
                              actions={[
                                {
                                  key: 'delete',
                                  label: 'Delete',
                                  icon: <Icon name="trash" size={16} />,
                                  tone: 'danger',
                                  onSelect: () => setDeleteEntryId(entry.id),
                                },
                              ]}
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
                </Table>
              </>
            )}
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Status Card */}
          <Card>
            <CardHeader title="Status" />
            <CardBody>
              <div className="flex flex-col items-start gap-3">
                <Badge tone={projectStatus.tone}>{projectStatus.label}</Badge>
                {canEdit && (
                  <Select
                    aria-label="Project status"
                    value={project.status}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    options={statusOptions}
                  />
                )}
              </div>
            </CardBody>
          </Card>

          {/* Contacts Card */}
          <Card>
            <CardHeader title="Contacts" />
            {contactsError ? (
              <CardBody>
                <Alert tone="danger" title="Could not load the contacts">
                  {contactsError}
                </Alert>
              </CardBody>
            ) : taggedContacts.length === 0 ? (
              <Empty size="sm" title="No contacts tagged" />
            ) : (
              <CardBody className="py-0">
                <div className="divide-y divide-border">
                  {taggedContacts.map((tc: any) => (
                    <div key={tc.id} className="flex items-start justify-between gap-2 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{tc.contact?.name || 'Unknown'}</p>
                        <p className="text-xs text-text-muted truncate">{tc.contact?.email || ''}</p>
                      </div>
                      {canEdit && (
                        <RowActions
                          actions={[
                            {
                              key: 'remove',
                              label: 'Remove',
                              icon: <Icon name="trash" size={16} />,
                              tone: 'danger',
                              onSelect: () => setRemoveContact({ id: tc.id, name: tc.contact?.name || 'this contact' }),
                            },
                          ]}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </CardBody>
            )}
          </Card>

          {/* Payment History */}
          {payments && payments.invoices && payments.invoices.length > 0 && (
            <Card>
              <CardHeader
                title="Payment History"
                subtitle="This project's share of each client invoice, inc VAT"
              />
              <CardBody>
                <DescriptionList
                  columns={3}
                  items={[
                    { key: 'billed', label: 'Billed', value: formatCurrency(payments.totals.totalBilled) },
                    {
                      key: 'paid',
                      label: 'Paid',
                      value: <span className={OJ_MONEY_TEXT.received}>{formatCurrency(payments.totals.totalPaid)}</span>,
                    },
                    {
                      key: 'outstanding',
                      label: 'Outstanding',
                      value: (
                        <span className={ojBalanceText(payments.totals.totalOutstanding)}>
                          {formatCurrency(payments.totals.totalOutstanding)}
                        </span>
                      ),
                    },
                  ]}
                />
                <div className="mt-3 divide-y divide-border border-t border-border">
                  {payments.invoices.map((item: any) => (
                    <div key={item.invoice.id} className="flex items-center justify-between py-3 text-sm">
                      <div>
                        <p className="font-medium">{item.invoice.number}</p>
                        <p className="text-xs text-text-muted">{item.invoice.date ? formatDateDdMmmmYyyy(item.invoice.date) : '-'}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{formatCurrency(item.invoice.total)}</p>
                        {typeof item.invoice.invoiceTotal === 'number' && item.invoice.invoiceTotal !== item.invoice.total && (
                          <p className="text-xs text-text-muted">
                            of {formatCurrency(item.invoice.invoiceTotal)} invoice
                          </p>
                        )}
                        <Badge tone={invoiceStatusTone(item.invoice.status)} dot>
                          {invoiceStatusLabel(item.invoice.status)}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardBody>
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
        message="Delete this entry? This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
      />
      <ConfirmDialog
        open={deleteProjectOpen}
        onClose={() => setDeleteProjectOpen(false)}
        onConfirm={handleDeleteProject}
        title="Delete Project"
        message="Delete this project? Only a project with no entries can be deleted."
        confirmLabel="Delete"
        tone="danger"
      />
      <ConfirmDialog
        open={removeContact !== null}
        onClose={() => setRemoveContact(null)}
        onConfirm={async () => {
          if (removeContact) await handleRemoveContact(removeContact.id)
        }}
        title="Remove Contact"
        message={`Remove ${removeContact?.name ?? 'this contact'} from this project?`}
        confirmLabel="Remove"
        tone="danger"
      />
    </PageLayout>
  )
}
