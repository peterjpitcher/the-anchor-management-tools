'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { Plus, Edit2, Trash2, X, ChevronLeft, Package } from 'lucide-react'
import Link from 'next/link'
import { getLineItemCatalog, createCatalogItem, updateCatalogItem, deleteCatalogItem } from '@/app/actions/invoices'
import type { LineItemCatalogItem } from '@/types/invoices'

interface CatalogFormData {
  name: string
  description: string
  default_price: number
  default_vat_rate: number
}

export default function LineItemCatalogPage() {
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
    loadCatalogItems()
  }, [])

  async function loadCatalogItems() {
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading catalog...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link href="/invoices">
        <Button variant="ghost" className="mb-4">
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back to Invoices
        </Button>
      </Link>
      
      <div className="mb-8 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">Line Item Catalog</h1>
          <p className="text-sm sm:text-base text-muted-foreground">Manage reusable line items for invoices and quotes</p>
        </div>
        <Button onClick={() => openForm()} className="w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-2" />
          Add Item
        </Button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 rounded-lg">
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
          <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500 mb-4">No catalog items found. Add common line items for quick reuse.</p>
          <Button onClick={() => openForm()}>
            <Plus className="h-4 w-4 mr-2" />
            Add Your First Item
          </Button>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block bg-white rounded-lg shadow-sm border">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left p-4 font-medium text-gray-700">Name</th>
                    <th className="text-left p-4 font-medium text-gray-700">Description</th>
                    <th className="text-right p-4 font-medium text-gray-700">Default Price</th>
                    <th className="text-right p-4 font-medium text-gray-700">VAT Rate</th>
                    <th className="text-right p-4 font-medium text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b hover:bg-gray-50">
                      <td className="p-4">
                        <div className="font-medium">{item.name}</div>
                      </td>
                      <td className="p-4 text-gray-600">
                        {item.description || '-'}
                      </td>
                      <td className="p-4 text-right">
                        £{item.default_price.toFixed(2)}
                      </td>
                      <td className="p-4 text-right">
                        {item.default_vat_rate}%
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openForm(item)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(item)}
                            className="text-red-600 hover:text-red-800"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-3">
            {items.map((item) => (
              <div key={item.id} className="bg-white rounded-lg shadow-sm border p-4">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900">{item.name}</h3>
                    {item.description && (
                      <p className="text-sm text-gray-600 mt-1">{item.description}</p>
                    )}
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openForm(item)}
                      className="min-h-[40px] min-w-[40px] p-2"
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(item)}
                      className="text-red-600 hover:text-red-800 min-h-[40px] min-w-[40px] p-2"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <div>
                    <span className="text-gray-500">Price:</span>
                    <span className="font-medium ml-1">£{item.default_price.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">VAT:</span>
                    <span className="font-medium ml-1">{item.default_vat_rate}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">
                {editingItem ? 'Edit Catalog Item' : 'Add Catalog Item'}
              </h2>
              <button
                onClick={closeForm}
                className="text-gray-400 hover:text-gray-600"
                disabled={formLoading}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  required
                  disabled={formLoading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[100px]"
                  rows={3}
                  disabled={formLoading}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Default Price (£) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    value={formData.default_price}
                    onChange={(e) => setFormData({ ...formData, default_price: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
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
                  <input
                    type="number"
                    value={formData.default_vat_rate}
                    onChange={(e) => setFormData({ ...formData, default_vat_rate: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                    step="0.01"
                    min="0"
                    max="100"
                    required
                    disabled={formLoading}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeForm}
                  disabled={formLoading}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={formLoading}>
                  {formLoading ? 'Saving...' : (editingItem ? 'Save Changes' : 'Add Item')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}