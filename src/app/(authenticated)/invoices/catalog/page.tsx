'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
import { Button } from '@/components/ui-v2/forms/Button'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { Input } from '@/components/ui-v2/forms/Input'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Card } from '@/components/ui-v2/layout/Card'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { Plus, Edit2, Trash2, Package } from 'lucide-react'
import { getLineItemCatalog, createCatalogItem, updateCatalogItem, deleteCatalogItem } from '@/app/actions/invoices'
import type { LineItemCatalogItem } from '@/types/invoices'
import { usePermissions } from '@/contexts/PermissionContext'

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load catalog')
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

  async function handleDelete(item: LineItemCatalogItem) {
    if (!canManage) {
      setError('You do not have permission to manage catalog items')
      return
    }

    if (!confirm(`Are you sure you want to delete "${item.name}"?`)) {
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

  if (permissionsLoading || loading) {
    return (
      <PageWrapper>
        <PageHeader 
          title="Line Item Catalog"
          subtitle="Manage reusable line items for invoices and quotes"
          backButton={{ label: 'Back to Invoices', href: '/invoices' }}
        />
        <PageContent>
          <div className="flex items-center justify-center h-64">
            <Spinner size="lg" />
          </div>
        </PageContent>
      </PageWrapper>
    )
  }

  if (!canView) {
    return null
  }

  return (
    <PageWrapper>
      <PageHeader
        title="Line Item Catalog"
        subtitle="Manage reusable line items for invoices and quotes"
        backButton={{ label: 'Back to Invoices', href: '/invoices' }}
        actions={
          <Button
            onClick={() => openForm()}
            leftIcon={<Plus className="h-4 w-4" />}
            disabled={!canManage}
            title={!canManage ? 'You need invoice manage permission to add catalog items.' : undefined}
          >
            Add Item
          </Button>
        }
      />
      <PageContent>
      {isReadOnly && (
        <Alert
          variant="info"
          description="You have read-only access to the catalog. Create, edit, and delete actions are disabled."
          className="mb-6"
        />
      )}
      {error && (
        <Alert variant="error" description={error} className="mb-6" />
      )}

      {items.length === 0 ? (
        <EmptyState icon={<Package className="h-12 w-12" />}
          title="No catalog items found"
          description="Add common line items for quick reuse."
          action={
            canManage ? (
              <Button onClick={() => openForm()} leftIcon={<Plus className="h-4 w-4" />}>
                Add Your First Item
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <DataTable
            data={items}
            getRowKey={(i) => i.id}
            columns={[
              { key: 'name', header: 'Name', cell: (i: LineItemCatalogItem) => <span className="font-medium">{i.name}</span> },
              { key: 'description', header: 'Description', cell: (i: LineItemCatalogItem) => <span className="text-gray-600">{i.description || '-'}</span> },
              { key: 'price', header: 'Default Price', align: 'right', cell: (i: LineItemCatalogItem) => <>£{i.default_price.toFixed(2)}</> },
              { key: 'vat', header: 'VAT Rate', align: 'right', cell: (i: LineItemCatalogItem) => <>{i.default_vat_rate}%</> },
              { key: 'actions', header: 'Actions', align: 'right', cell: (i: LineItemCatalogItem) => (
                <div className="flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openForm(i)}
                    aria-label="Edit item"
                    iconOnly
                    disabled={!canManage}
                    title={!canManage ? 'You need invoice manage permission to edit catalog items.' : undefined}
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleDelete(i)}
                    aria-label="Delete item"
                    iconOnly
                    disabled={!canManage}
                    title={!canManage ? 'You need invoice manage permission to delete catalog items.' : undefined}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ) },
            ]}
            emptyMessage="No catalog items found"
            renderMobileCard={(i: LineItemCatalogItem) => (
              <div className="p-2">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 truncate">{i.name}</div>
                    {i.description && <div className="text-sm text-gray-600 mt-1 truncate">{i.description}</div>}
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openForm(i)}
                      aria-label="Edit item"
                      iconOnly
                      disabled={!canManage}
                      title={!canManage ? 'You need invoice manage permission to edit catalog items.' : undefined}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelete(i)}
                      aria-label="Delete item"
                      iconOnly
                      disabled={!canManage}
                      title={!canManage ? 'You need invoice manage permission to delete catalog items.' : undefined}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <div><span className="text-gray-500">Price:</span> <span className="font-medium">£{i.default_price.toFixed(2)}</span></div>
                  <div><span className="text-gray-500">VAT:</span> <span className="font-medium">{i.default_vat_rate}%</span></div>
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
        size="sm"
        footer={
          <ModalActions>
            <Button
              type="button"
              variant="secondary"
              onClick={closeForm}
              disabled={formLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="catalog-form"
              disabled={formLoading || !canManage}
              loading={formLoading}
            >
              {editingItem ? 'Save Changes' : 'Add Item'}
            </Button>
          </ModalActions>
        }
      >

        <form id="catalog-form" onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <Input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  disabled={formLoading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Description
                </label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  disabled={formLoading}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Default Price (£) <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="number"
                    value={formData.default_price}
                    onChange={(e) => setFormData({ ...formData, default_price: parseFloat(e.target.value) || 0 })}
                    step="0.01"
                    min="0"
                    required
                    disabled={formLoading}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    VAT Rate (%) <span className="text-red-500">*</span>
                  </label>
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
                </div>
              </div>

        </form>
      </Modal>
      </PageContent>
    </PageWrapper>
  )
}
