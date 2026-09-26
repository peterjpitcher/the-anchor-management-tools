'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  PageLayout,
  Icon,
  Button,
  IconButton,
  Modal,
  Input,
  Textarea,
  Field,
  Card,
  Alert,
  ConfirmDialog,
  DataTable,
} from '@/ds'
import { getLineItemCatalog, createCatalogItem, updateCatalogItem, deleteCatalogItem } from '@/app/actions/invoices'
import type { LineItemCatalogItem } from '@/types/invoices'
import { usePermissions } from '@/contexts/PermissionContext'
import { financeNav } from '../_shared/nav'

interface CatalogFormData {
  name: string
  description: string
  default_price: number
  default_vat_rate: number
}

export default function LineItemCatalogPage() {
  const router = useRouter()
  const { hasPermission, loading: permissionsLoading } = usePermissions()
  const canView = hasPermission('invoices', 'view')
  const canManage = hasPermission('invoices', 'manage')
  const isReadOnly = canView && !canManage

  const [items, setItems] = useState<LineItemCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingItem, setEditingItem] = useState<LineItemCatalogItem | null>(null)
  const [formData, setFormData] = useState<CatalogFormData>({
    name: '',
    description: '',
    default_price: 0,
    default_vat_rate: 20
  })
  const [formLoading, setFormLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A failed load is kept apart from a failed save or delete, so it is never drawn as an empty catalog.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LineItemCatalogItem | null>(null)

  useEffect(() => {
    if (permissionsLoading) {
      return
    }

    if (!canView) {
      router.replace('/unauthorized')
      return
    }

    loadCatalogItems()
  }, [permissionsLoading, canView, router])

  async function loadCatalogItems() {
    if (!canView) {
      return
    }

    try {
      const result = await getLineItemCatalog()

      if (result.error || !result.items) {
        throw new Error(result.error || 'Failed to load catalog items')
      }

      setItems(result.items)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load catalog')
    } finally {
      setLoading(false)
    }
  }

  function openForm(item?: LineItemCatalogItem) {
    if (!canManage) {
      setError('You do not have permission to manage catalog items')
      return
    }

    if (item) {
      setEditingItem(item)
      setFormData({
        name: item.name,
        description: item.description || '',
        default_price: item.default_price,
        default_vat_rate: item.default_vat_rate
      })
    } else {
      setEditingItem(null)
      setFormData({
        name: '',
        description: '',
        default_price: 0,
        default_vat_rate: 20
      })
    }
    setShowForm(true)
    setError(null)
  }

  function closeForm() {
    setShowForm(false)
    setEditingItem(null)
    setFormData({
      name: '',
      description: '',
      default_price: 0,
      default_vat_rate: 20
    })
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canManage) {
      setError('You do not have permission to manage catalog items')
      return
    }
    setFormLoading(true)
    setError(null)

    try {
      const formDataToSend = new FormData()
      formDataToSend.append('name', formData.name)
      formDataToSend.append('description', formData.description)
      formDataToSend.append('default_price', formData.default_price.toString())
      formDataToSend.append('default_vat_rate', formData.default_vat_rate.toString())

      if (editingItem) {
        formDataToSend.append('itemId', editingItem.id)
        const result = await updateCatalogItem(formDataToSend)
        if (result.error) throw new Error(result.error)
      } else {
        const result = await createCatalogItem(formDataToSend)
        if (result.error) throw new Error(result.error)
      }

      await loadCatalogItems()
      closeForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save item')
    } finally {
      setFormLoading(false)
    }
  }

  function requestDelete(item: LineItemCatalogItem) {
    if (!canManage) {
      setError('You do not have permission to manage catalog items')
      return
    }
    setDeleteTarget(item)
  }

  async function handleDelete(item: LineItemCatalogItem) {
    if (!canManage) {
      setError('You do not have permission to manage catalog items')
      return
    }

    try {
      const formData = new FormData()
      formData.append('itemId', item.id)
      
      const result = await deleteCatalogItem(formData)
      if (result.error) throw new Error(result.error)
      
      await loadCatalogItems()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete item')
    }
  }

  const layoutProps = {
    title: 'Invoices',
    subtitle: 'Catalog of reusable line items for invoices and quotes',
    navItems: financeNav({ canExport: hasPermission('invoices', 'export') }),
  }

  if (permissionsLoading || loading) {
    return <PageLayout {...layoutProps} loading loadingLabel="Loading catalog" />
  }

  if (!canView) {
    return null
  }

  const itemActions = (i: LineItemCatalogItem) => (
    <div className="flex justify-end gap-2">
      <IconButton
        variant="secondary"
        size="sm"
        onClick={() => openForm(i)}
        label="Edit item"
        icon={<Icon name="edit" size={16} />}
        disabled={!canManage}
        title={!canManage ? 'You need invoice manage permission to edit catalog items.' : undefined}
      />
      <IconButton
        variant="danger"
        size="sm"
        onClick={() => requestDelete(i)}
        label="Delete item"
        icon={<Icon name="trash" size={16} />}
        disabled={!canManage}
        title={!canManage ? 'You need invoice manage permission to delete catalog items.' : undefined}
      />
    </div>
  )

  return (
    <PageLayout
      {...layoutProps}
      headerActions={
        canManage ? (
          <Button variant="primary"
            size="sm"
            onClick={() => openForm()}
            leftIcon={<Icon name="plus" size={16} />}
          >
            Add Item
          </Button>
        ) : undefined
      }
    >
      {isReadOnly && (
        <Alert tone="info">
          You have read-only access to the catalog. Create, edit, and delete actions are disabled.
        </Alert>
      )}
      {error && !showForm && <Alert tone="danger">{error}</Alert>}

      {loadError ? (
        <Alert tone="danger" title="Could not load the catalog">{loadError}</Alert>
      ) : (
        <Card padding="none">
          <DataTable
            data={items}
            getRowKey={(i) => i.id}
            bordered={false}
            columns={[
              { key: 'name', header: 'Name', cell: (i: LineItemCatalogItem) => <span className="font-medium">{i.name}</span> },
              { key: 'description', header: 'Description', cell: (i: LineItemCatalogItem) => <span className="text-text-muted">{i.description || '-'}</span> },
              { key: 'price', header: 'Default Price', align: 'right', cell: (i: LineItemCatalogItem) => <>£{i.default_price.toFixed(2)}</> },
              { key: 'vat', header: 'VAT Rate', align: 'right', cell: (i: LineItemCatalogItem) => <>{i.default_vat_rate}%</> },
              { key: 'actions', header: 'Actions', align: 'right', cell: itemActions },
            ]}
            emptyMessage="No catalog items found"
            emptyDescription="Add common line items for quick reuse."
            renderMobileCard={(i: LineItemCatalogItem) => (
              <div className="border-b border-border p-pad-card">
                <div className="mb-2 flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-text">{i.name}</div>
                    {i.description && <div className="mt-1 truncate text-sm text-text-muted">{i.description}</div>}
                  </div>
                  <div className="ml-4">{itemActions(i)}</div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div><span className="text-text-muted">Price:</span> <span className="font-medium">£{i.default_price.toFixed(2)}</span></div>
                  <div><span className="text-text-muted">VAT:</span> <span className="font-medium">{i.default_vat_rate}%</span></div>
                </div>
              </div>
            )}
          />
        </Card>
      )}

      {/* Form Modal */}
      <Modal
        open={showForm}
        onClose={closeForm}
        title={editingItem ? 'Edit Catalog Item' : 'Add Catalog Item'}
        width="sm"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={closeForm}
              disabled={formLoading}
            >
              Cancel
            </Button>
            <Button variant="primary"
              type="submit"
              form="catalog-form"
              disabled={formLoading || !canManage}
              loading={formLoading}
            >
              {editingItem ? 'Save Changes' : 'Add Item'}
            </Button>
          </>
        }
      >
        <form id="catalog-form" onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}

          <Field label="Name" required>
            <Input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              disabled={formLoading}
            />
          </Field>

          <Textarea
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={3}
            disabled={formLoading}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Default Price (£)" required>
              <Input
                type="number"
                value={formData.default_price}
                onChange={(e) => setFormData({ ...formData, default_price: parseFloat(e.target.value) || 0 })}
                step="0.01"
                min="0"
                required
                disabled={formLoading}
              />
            </Field>

            <Field label="VAT Rate (%)" required>
              <Input
                type="number"
                value={formData.default_vat_rate}
                onChange={(e) => setFormData({ ...formData, default_vat_rate: parseFloat(e.target.value) || 0 })}
                step="0.01"
                min="0"
                max="100"
                required
                disabled={formLoading}
              />
            </Field>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) await handleDelete(deleteTarget)
        }}
        title="Delete Catalog Item"
        message={deleteTarget ? `Are you sure you want to delete "${deleteTarget.name}"?` : undefined}
        confirmLabel="Delete"
        tone="danger"
      />
    </PageLayout>
  )
}
