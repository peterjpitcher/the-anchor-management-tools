'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getRecurringInvoices, deleteRecurringInvoice, generateInvoiceFromRecurring, toggleRecurringInvoiceStatus } from '@/app/actions/recurring-invoices'
import {
  PageLayout,
  Icon,
  Card,
  IconButton,
  LinkButton,
  Badge,
  DataTable,
  toast,
  ConfirmDialog,
  Alert,
} from '@/ds'
import type { RecurringInvoiceWithDetails } from '@/types/invoices'
import { usePermissions } from '@/contexts/PermissionContext'
import { formatDateInLondon } from '@/lib/dateUtils'
import { financeNav } from '../_shared/nav'
import { recurringScheduleLabel, recurringScheduleTone } from '../_shared/status-ui'

type GenerateInvoiceActionResult = Awaited<ReturnType<typeof generateInvoiceFromRecurring>>

export default function RecurringInvoicesPage() {
  const router = useRouter()
  const { hasPermission, loading: permissionsLoading } = usePermissions()
  const canView = hasPermission('invoices', 'view')
  const canCreate = hasPermission('invoices', 'create')
  const canEdit = hasPermission('invoices', 'edit')
  const canDelete = hasPermission('invoices', 'delete')
  const isReadOnly = canView && !canCreate && !canEdit && !canDelete

  const [recurringInvoices, setRecurringInvoices] = useState<RecurringInvoiceWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
  const [generateTarget, setGenerateTarget] = useState<string | null>(null)
  const [toggleTarget, setToggleTarget] = useState<{ id: string; isActive: boolean } | null>(null)
  // A failed load is shown as a failure, never as an empty list of schedules.
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (permissionsLoading) {
      return
    }

    if (!canView) {
      router.replace('/unauthorized')
      return
    }

    loadRecurringInvoices()
  }, [permissionsLoading, canView, router])

  async function loadRecurringInvoices() {
    if (!canView) {
      return
    }

    setLoading(true)
    try {
      const result = await getRecurringInvoices()
      if (result.recurringInvoices) {
        setRecurringInvoices(result.recurringInvoices)
        setLoadError(null)
      } else {
        setLoadError(result.error || 'Failed to load recurring invoices')
      }
    } catch (error) {
      console.error('Error loading recurring invoices:', error)
      setLoadError('Failed to load recurring invoices')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    if (!canDelete) {
      toast.error('You do not have permission to delete recurring invoices')
      return
    }

    setProcessing(id)
    try {
      const formData = new FormData()
      formData.append('id', id)
      
      const result = await deleteRecurringInvoice(formData)
      if (result.success) {
        toast.success('Recurring invoice deleted successfully')
        await loadRecurringInvoices()
      } else {
        toast.error(result.error || 'Failed to delete recurring invoice')
      }
    } catch (error) {
      console.error('Error deleting recurring invoice:', error)
      toast.error('Failed to delete recurring invoice')
    } finally {
      setProcessing(null)
      setShowDeleteConfirm(null)
    }
  }

  function requestGenerateNow(id: string) {
    if (!canCreate) {
      toast.error('You do not have permission to generate invoices')
      return
    }
    setGenerateTarget(id)
  }

  async function handleGenerateNow(id: string) {
    if (!canCreate) {
      toast.error('You do not have permission to generate invoices')
      return
    }

    setProcessing(id)
    try {
      const result = await generateInvoiceFromRecurring(id) as GenerateInvoiceActionResult
      if ('error' in result && result.error) {
        toast.error(result.error)
      } else if ('success' in result && result.success && 'invoice' in result && result.invoice) {
        toast.success(`Invoice ${result.invoice.invoice_number} generated successfully`)
        await loadRecurringInvoices()
        router.push(`/invoices/${result.invoice.id}`)
      } else {
        toast.error('Failed to generate invoice')
      }
    } catch (error) {
      console.error('Error generating invoice:', error)
      toast.error('Failed to generate invoice')
    } finally {
      setProcessing(null)
    }
  }

  function requestToggleStatus(id: string, currentStatus: boolean) {
    if (!canEdit) {
      toast.error('You do not have permission to update recurring invoices')
      return
    }
    setToggleTarget({ id, isActive: currentStatus })
  }

  async function handleToggleStatus(id: string, currentStatus: boolean) {
    if (!canEdit) {
      toast.error('You do not have permission to update recurring invoices')
      return
    }

    const action = currentStatus ? 'deactivate' : 'activate'

    setProcessing(id)
    try {
      const formData = new FormData()
      formData.append('id', id)
      formData.append('current_status', currentStatus.toString())
      
      const result = await toggleRecurringInvoiceStatus(formData)
      if (result.success) {
        toast.success(`Recurring invoice ${action}d successfully`)
        await loadRecurringInvoices()
      } else {
        toast.error(result.error || `Failed to ${action} recurring invoice`)
      }
    } catch (error) {
      console.error(`Error ${action}ing recurring invoice:`, error)
      toast.error(`Failed to ${action} recurring invoice`)
    } finally {
      setProcessing(null)
    }
  }

  function getFrequencyLabel(frequency: string): string {
    return frequency.charAt(0).toUpperCase() + frequency.slice(1)
  }

  function getNextInvoiceLabel(date: string): string {
    const nextDate = new Date(date)
    const today = new Date()
    const daysUntil = Math.ceil((nextDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    
    if (daysUntil < 0) {
      return 'Overdue'
    } else if (daysUntil === 0) {
      return 'Today'
    } else if (daysUntil === 1) {
      return 'Tomorrow'
    } else if (daysUntil <= 7) {
      return `In ${daysUntil} days`
    } else {
      return formatDateInLondon(date)
    }
  }

  const layoutProps = {
    title: 'Invoices',
    subtitle: 'Recurring invoices raised automatically on a schedule',
    navItems: financeNav({ canExport: hasPermission('invoices', 'export') }),
  }

  if (permissionsLoading || loading) {
    return <PageLayout {...layoutProps} loading loadingLabel="Loading recurring schedules" />
  }

  if (!canView) {
    return null
  }

  const statusBadge = (r: RecurringInvoiceWithDetails, className?: string) => (
    <Badge
      tone={recurringScheduleTone(r.is_active)}
      icon={<Icon name={r.is_active ? 'play' : 'pause'} size={12} />}
      className={className}
    >
      {recurringScheduleLabel(r.is_active)}
    </Badge>
  )

  const rowActions = (r: RecurringInvoiceWithDetails) => (
    <>
      <IconButton
        variant="secondary"
        size="sm"
        onClick={() => requestToggleStatus(r.id, r.is_active)}
        disabled={processing === r.id || !canEdit}
        loading={processing === r.id}
        title={
          !canEdit
            ? 'You need invoice edit permission to change status.'
            : r.is_active
              ? 'Deactivate recurring invoice'
              : 'Activate recurring invoice'
        }
        label={r.is_active ? 'Deactivate recurring invoice' : 'Activate recurring invoice'}
        icon={<Icon name={r.is_active ? 'pause' : 'play'} size={16} />}
      />
      <IconButton
        variant="secondary"
        size="sm"
        onClick={() => requestGenerateNow(r.id)}
        disabled={processing === r.id || !r.is_active || !canCreate}
        loading={processing === r.id}
        title={
          !canCreate
            ? 'You need invoice create permission to generate invoices.'
            : !r.is_active
              ? 'Activate the schedule before generating.'
              : 'Generate invoice now'
        }
        label="Generate invoice now"
        icon={<Icon name="calendar" size={16} />}
      />
      <IconButton
        variant="secondary"
        size="sm"
        onClick={() => router.push(`/invoices/recurring/${r.id}`)}
        disabled={processing === r.id}
        title="View details"
        label="View details"
        icon={<Icon name="edit" size={16} />}
      />
      <IconButton
        variant="danger"
        size="sm"
        onClick={() => setShowDeleteConfirm(r.id)}
        disabled={processing === r.id || !canDelete}
        loading={processing === r.id}
        title={
          !canDelete
            ? 'You need invoice delete permission to remove recurring invoices.'
            : undefined
        }
        label="Delete recurring invoice"
        icon={<Icon name="trash" size={16} />}
      />
    </>
  )

  return (
    <PageLayout
      {...layoutProps}
      headerActions={
        canCreate ? (
          <LinkButton
            href="/invoices/recurring/new"
            variant="primary"
            size="sm"
            icon={<Icon name="plus" size={16} />}
          >
            New Recurring Invoice
          </LinkButton>
        ) : undefined
      }
    >
      {isReadOnly && (
        <Alert tone="info">
          You have read-only access to recurring invoices; creation and management actions are disabled.
        </Alert>
      )}

      {loadError ? (
        <Alert tone="danger" title="Could not load recurring invoices">{loadError}</Alert>
      ) : (
        <Card padding="none">
          <DataTable
            data={recurringInvoices}
            getRowKey={(r) => r.id}
            bordered={false}
            columns={[
              {
                key: 'vendor',
                header: 'Vendor',
                cell: (r) => (
                  <div>
                    <div className="text-sm font-medium text-text">{r.vendor?.name || 'Unknown Vendor'}</div>
                    {r.vendor?.contact_name && (
                      <div className="text-sm text-text-muted">{r.vendor.contact_name}</div>
                    )}
                  </div>
                )
              },
              {
                key: 'frequency',
                header: 'Frequency',
                cell: (r) => <span className="text-sm text-text">{getFrequencyLabel(r.frequency)}</span>
              },
              {
                key: 'next',
                header: 'Next Invoice',
                cell: (r) => (
                  <div>
                    <div className="text-sm text-text">{getNextInvoiceLabel(r.next_invoice_date)}</div>
                    <div className="text-xs text-text-muted">{formatDateInLondon(r.next_invoice_date)}</div>
                  </div>
                )
              },
              {
                key: 'reference',
                header: 'Reference',
                cell: (r) => <span className="text-sm text-text">{r.reference || '-'}</span>
              },
              {
                key: 'status',
                header: 'Status',
                cell: (r) => statusBadge(r)
              },
              {
                key: 'actions',
                header: 'Actions',
                align: 'right',
                cell: (r) => <div className="flex justify-end gap-2">{rowActions(r)}</div>
              },
            ]}
            renderMobileCard={(r) => (
              <div className="space-y-3 border-b border-border p-pad-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-text">{r.vendor?.name || 'Unknown Vendor'}</div>
                    {r.vendor?.contact_name && (
                      <div className="text-sm text-text-muted">{r.vendor.contact_name}</div>
                    )}
                  </div>
                  {statusBadge(r, 'shrink-0')}
                </div>
                <dl className="grid gap-2 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-text-muted">Frequency</dt>
                    <dd className="text-text">{getFrequencyLabel(r.frequency)}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-text-muted">Next Invoice</dt>
                    <dd className="text-right text-text">
                      <div>{getNextInvoiceLabel(r.next_invoice_date)}</div>
                      <div className="text-xs text-text-muted">{formatDateInLondon(r.next_invoice_date)}</div>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-text-muted">Reference</dt>
                    <dd className="min-w-0 break-words text-right text-text">{r.reference || '-'}</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                  {rowActions(r)}
                </div>
              </div>
            )}
            emptyMessage="No recurring invoices"
            emptyDescription="Create recurring invoices to automate your billing"
          />
        </Card>
      )}

      <ConfirmDialog
        open={showDeleteConfirm !== null}
        onClose={() => setShowDeleteConfirm(null)}
        onConfirm={() => showDeleteConfirm && handleDelete(showDeleteConfirm)}
        title="Delete Recurring Invoice"
        message="Are you sure you want to delete this recurring invoice? This action cannot be undone."
        confirmLabel="Delete"
        tone="danger"
      />

      <ConfirmDialog
        open={generateTarget !== null}
        onClose={() => setGenerateTarget(null)}
        onConfirm={async () => {
          if (generateTarget) await handleGenerateNow(generateTarget)
        }}
        title="Generate Invoice Now"
        message="Generate invoice now? This will create a new invoice immediately."
        confirmLabel="Generate Invoice"
        tone="primary"
      />

      <ConfirmDialog
        open={toggleTarget !== null}
        onClose={() => setToggleTarget(null)}
        onConfirm={async () => {
          if (toggleTarget) await handleToggleStatus(toggleTarget.id, toggleTarget.isActive)
        }}
        title={toggleTarget?.isActive ? 'Deactivate Recurring Invoice' : 'Activate Recurring Invoice'}
        message={`Are you sure you want to ${toggleTarget?.isActive ? 'deactivate' : 'activate'} this recurring invoice?`}
        confirmLabel={toggleTarget?.isActive ? 'Deactivate' : 'Activate'}
        tone="primary"
      />
    </PageLayout>
  )
}
