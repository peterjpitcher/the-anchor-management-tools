'use client'

import { useState, useEffect } from 'react'
import { getVendors, createVendor, updateVendor, deleteVendor } from '@/app/actions/vendors'
import { Button } from '@/components/ui/Button'
import { Plus, Edit2, Trash2, X, ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import type { InvoiceVendor } from '@/types/invoices'

interface VendorFormData {
  name: string
  contact_name: string
  email: string
  phone: string
  address: string
  vat_number: string
  payment_terms: number
  notes: string
}

export default function VendorsPage() {
  const [vendors, setVendors] = useState<InvoiceVendor[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingVendor, setEditingVendor] = useState<InvoiceVendor | null>(null)
  const [formData, setFormData] = useState<VendorFormData>({
    name: '',
    contact_name: '',
    email: '',
    phone: '',
    address: '',
    vat_number: '',
    payment_terms: 30,
    notes: ''
  })
  const [formLoading, setFormLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadVendors()
  }, [])

  async function loadVendors() {
    try {
      const result = await getVendors()
      
      if (result.error || !result.vendors) {
        throw new Error(result.error || 'Failed to load vendors')
      }

      setVendors(result.vendors)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load vendors')
    } finally {
      setLoading(false)
    }
  }

  function openForm(vendor?: InvoiceVendor) {
    if (vendor) {
      setEditingVendor(vendor)
      setFormData({
        name: vendor.name,
        contact_name: vendor.contact_name || '',
        email: vendor.email || '',
        phone: vendor.phone || '',
        address: vendor.address || '',
        vat_number: vendor.vat_number || '',
        payment_terms: vendor.payment_terms || 30,
        notes: vendor.notes || ''
      })
    } else {
      setEditingVendor(null)
      setFormData({
        name: '',
        contact_name: '',
        email: '',
        phone: '',
        address: '',
        vat_number: '',
        payment_terms: 30,
        notes: ''
      })
    }
    setShowForm(true)
    setError(null)
  }

  function closeForm() {
    setShowForm(false)
    setEditingVendor(null)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormLoading(true)
    setError(null)

    try {
      const form = new FormData()
      Object.entries(formData).forEach(([key, value]) => {
        form.append(key, value.toString())
      })

      if (editingVendor) {
        form.append('vendorId', editingVendor.id)
        const result = await updateVendor(form)
        
        if (result.error) {
          throw new Error(result.error)
        }
      } else {
        const result = await createVendor(form)
        
        if (result.error) {
          throw new Error(result.error)
        }
      }

      await loadVendors()
      closeForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save vendor')
    } finally {
      setFormLoading(false)
    }
  }

  async function handleDelete(vendor: InvoiceVendor) {
    if (!confirm(`Are you sure you want to delete ${vendor.name}? This action cannot be undone.`)) {
      return
    }

    try {
      const form = new FormData()
      form.append('vendorId', vendor.id)
      
      const result = await deleteVendor(form)
      
      if (result.error) {
        throw new Error(result.error)
      }

      await loadVendors()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete vendor')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading vendors...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <Link href="/invoices">
        <Button variant="ghost" className="mb-4">
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back to Invoices
        </Button>
      </Link>
      
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold mb-2">Vendors</h1>
          <p className="text-muted-foreground">Manage your invoice vendors</p>
        </div>
        <Button onClick={() => openForm()}>
          <Plus className="h-4 w-4 mr-2" />
          Add Vendor
        </Button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 rounded-lg">
          {error}
        </div>
      )}

      {vendors.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
          <p className="text-gray-500 mb-4">No vendors found. Add your first vendor to get started.</p>
          <Button onClick={() => openForm()}>
            <Plus className="h-4 w-4 mr-2" />
            Add Your First Vendor
          </Button>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-4 font-medium text-gray-700">Name</th>
                  <th className="text-left p-4 font-medium text-gray-700">Contact</th>
                  <th className="text-left p-4 font-medium text-gray-700">Email</th>
                  <th className="text-left p-4 font-medium text-gray-700">Payment Terms</th>
                  <th className="text-right p-4 font-medium text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((vendor) => (
                  <tr key={vendor.id} className="border-b hover:bg-gray-50">
                    <td className="p-4">
                      <div>
                        <div className="font-medium">{vendor.name}</div>
                        {vendor.vat_number && (
                          <div className="text-sm text-gray-500">VAT: {vendor.vat_number}</div>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="text-sm">
                        {vendor.contact_name || '-'}
                        {vendor.phone && (
                          <div className="text-gray-500">{vendor.phone}</div>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-sm">
                      {vendor.email || '-'}
                    </td>
                    <td className="p-4 text-sm">
                      {vendor.payment_terms} days
                    </td>
                    <td className="p-4">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openForm(vendor)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDelete(vendor)}
                          className="text-red-600 hover:bg-red-50"
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
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b flex justify-between items-center">
              <h2 className="text-xl font-semibold">
                {editingVendor ? 'Edit Vendor' : 'Add New Vendor'}
              </h2>
              <button
                onClick={closeForm}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium mb-1">
                    Company Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Contact Name
                  </label>
                  <input
                    type="text"
                    value={formData.contact_name}
                    onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    VAT Number
                  </label>
                  <input
                    type="text"
                    value={formData.vat_number}
                    onChange={(e) => setFormData({ ...formData, vat_number: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Payment Terms (days)
                  </label>
                  <input
                    type="number"
                    value={formData.payment_terms}
                    onChange={(e) => setFormData({ ...formData, payment_terms: parseInt(e.target.value) || 30 })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    min="0"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium mb-1">
                    Address
                  </label>
                  <textarea
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium mb-1">
                    Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-4 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeForm}
                  disabled={formLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={formLoading}
                >
                  {formLoading ? 'Saving...' : (editingVendor ? 'Update' : 'Create')} Vendor
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}