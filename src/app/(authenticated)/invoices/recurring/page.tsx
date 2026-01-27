'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getRecurringInvoices, deleteRecurringInvoice, generateInvoiceFromRecurring, toggleRecurringInvoiceStatus } from '@/app/actions/recurring-invoices'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup'
import { NavLink } from '@/components/ui-v2/navigation/NavLink'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'
import { Plus, Calendar, Trash2, Edit, Play, Pause } from 'lucide-react'
import type { RecurringInvoiceWithDetails } from '@/types/invoices'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { usePermissions } from '@/contexts/PermissionContext'
import { formatDateInLondon } from '@/lib/dateUtils'

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
      }
    } catch (error) {
      console.error('Error loading recurring invoices:', error)
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

  async function handleGenerateNow(id: string) {
    if (!canCreate) {
      toast.error('You do not have permission to generate invoices')
      return
    }

    if (!confirm('Generate invoice now? This will create a new invoice immediately.')) {
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

  async function handleToggleStatus(id: string, currentStatus: boolean) {
    if (!canEdit) {
      toast.error('You do not have permission to update recurring invoices')
      return
    }

    const action = currentStatus ? 'deactivate' : 'activate'
    if (!confirm(`Are you sure you want to ${action} this recurring invoice?`)) {
      return
    }

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

  if (permissionsLoading || loading) {
    return (
      <PageLayout
        title="Recurring Invoices"
        backButton={{ label: 'Back to Invoices', href: '/invoices' }}
        loading
        loadingLabel="Loading recurring schedules..."
      />
    )
  }

  if (!canView) {
    return null
  }

  return (
    <PageLayout
      title="Recurring Invoices"
      subtitle="Manage automated invoice generation"
      breadcrumbs={[{ label: 'Invoices', href: '/invoices' }]}
      navActions={
        <NavGroup>
          <NavLink
            href="/invoices/recurring/new"
            disabled={!canCreate}
            title={!canCreate ? 'You need invoice create permission to add recurring invoices.' : undefined}
            className="font-semibold"
          >
            <Plus className="h-4 w-4" />
            New Recurring Invoice
          </NavLink>
        </NavGroup>
      }
    >
      <div className="space-y-6">
        {isReadOnly && (
          <Alert
            variant="info"
            description="You have read-only access to recurring invoices; creation and management actions are disabled."
          />
        )}

        {recurringInvoices.length === 0 ? (
          <EmptyState
            icon={<Calendar className="h-12 w-12" />}
            title="No recurring invoices"
            description="Create recurring invoices to automate your billing"
            action={
              canCreate ? (
                <Button onClick={() => router.push('/invoices/recurring/new')} leftIcon={<Plus className="h-4 w-4" />}>
                  Create schedule
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Card>
            <DataTable
              data={recurringInvoices}
              getRowKey={(r) => r.id}
              columns={[
              {
                key: 'vendor',
                header: 'Vendor',
                cell: (r) => (
                  <div>
                    <div className="text-sm font-medium text-gray-900">{r.vendor?.name || 'Unknown Vendor'}</div>
                    {r.vendor?.contact_name && (
                      <div className="text-sm text-gray-500">{r.vendor.contact_name}</div>
                    )}
                  </div>
                )
              },
              {
                key: 'frequency',
                header: 'Frequency',
                cell: (r) => <span className="text-sm text-gray-900">{getFrequencyLabel(r.frequency)}</span>
              },
              {
                key: 'next',
                header: 'Next Invoice',
                cell: (r) => (
                  <div>
                    <div className="text-sm text-gray-900">{getNextInvoiceLabel(r.next_invoice_date)}</div>
                    <div className="text-xs text-gray-500">{formatDateInLondon(r.next_invoice_date)}</div>
                  </div>
                )
              },
              {
                key: 'reference',
                header: 'Reference',
                cell: (r) => <span className="text-sm text-gray-900">{r.reference || '-'}</span>
              },
              {
                key: 'status',
                header: 'Status',
                cell: (r) => r.is_active ? (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    <Play className="h-3 w-3 mr-1" /> Active
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                    <Pause className="h-3 w-3 mr-1" /> Inactive
                  </span>
                )
              },
              {
                key: 'actions',
                header: 'Actions',
                align: 'right',
                cell: (r) => (
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleToggleStatus(r.id, r.is_active)}
                      disabled={processing === r.id || !canEdit}
                      loading={processing === r.id}
                      title={
                        !canEdit
                          ? 'You need invoice edit permission to change status.'
                          : r.is_active
                            ? 'Deactivate recurring invoice'
                            : 'Activate recurring invoice'
                      }
                      iconOnly
                    >
                      {r.is_active ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleGenerateNow(r.id)}
                      disabled={processing === r.id || !r.is_active || !canCreate}
                      loading={processing === r.id}
                      title={
                        !canCreate
                          ? 'You need invoice create permission to generate invoices.'
                          : !r.is_active
                            ? 'Activate the schedule before generating.'
                            : 'Generate invoice now'
                      }
                      iconOnly
                    >
                      <Calendar className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => router.push(`/invoices/recurring/${r.id}`)}
                      disabled={processing === r.id}
                      title="View details"
                      iconOnly
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
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
                      iconOnly
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )
              },
            ]}
              emptyMessage="No recurring invoices"
            />
          </Card>
        )}

        <ConfirmDialog
          open={showDeleteConfirm !== null}
          onClose={() => setShowDeleteConfirm(null)}
          onConfirm={() => showDeleteConfirm && handleDelete(showDeleteConfirm)}
          title="Delete Recurring Invoice"
          message="Are you sure you want to delete this recurring invoice? This action cannot be undone."
          confirmText="Delete"
          confirmVariant="danger"
        />
      </div>
    </PageLayout>
  )
}
