'use client'

import { useState, useEffect } from 'react'
import { getVendors, createVendor, updateVendor, deleteVendor } from '@/app/actions/vendors'
import { Page } from '@/components/ui-v2/layout/Page'
import { Button } from '@/components/ui-v2/forms/Button'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { Input } from '@/components/ui-v2/forms/Input'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Card } from '@/components/ui-v2/layout/Card'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'
import { Plus, Edit2, Trash2, X, ChevronLeft } from 'lucide-react'
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
          <Spinner size="lg" />
          <p className="mt-4 text-gray-600">Loading vendors...</p>
        </div>
      </div>
    )
  }

  return (
    <Page
      title="Vendors"
      description="Manage your invoice vendors"
      breadcrumbs={[
        { label: 'Invoices', href: '/invoices' },
        { label: 'Vendors' }
      ]}
      actions={
        <Button onClick={() => openForm()} leftIcon={<Plus className="h-4 w-4" />}>
          Add Vendor
        </Button>
      }
    >
      {error && (
        <Alert variant="error" description={error} className="mb-6" />
      )}

      {vendors.length === 0 ? (
        <EmptyState
          title="No vendors found"
          description="Add your first vendor to get started."
          action={
            <Button onClick={() => openForm()} leftIcon={<Plus className="h-4 w-4" />}>
              Add Your First Vendor
            </Button>
          }
        />
      ) : (
        <Card>
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
                          variant="secondary"
                          onClick={() => openForm(vendor)}
                          aria-label="Edit vendor"
                          iconOnly
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleDelete(vendor)}
                          aria-label="Delete vendor"
                          iconOnly
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
        </Card>
      )}

      <Modal
        open={showForm}
        onClose={closeForm}
        title={editingVendor ? 'Edit Vendor' : 'Add New Vendor'}
        size="lg"
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
              form="vendor-form"
              disabled={formLoading}
              loading={formLoading}
            >
              {editingVendor ? 'Update' : 'Create'} Vendor
            </Button>
          </ModalActions>
        }
      >

        <form id="vendor-form" onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormGroup label="Company Name" required className="md:col-span-2">
                  <Input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </FormGroup>

                <FormGroup label="Contact Name">
                  <Input
                    type="text"
                    value={formData.contact_name}
                    onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })}
                  />
                </FormGroup>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Email
                  </label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Phone
                  </label>
                  <Input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    VAT Number
                  </label>
                  <Input
                    type="text"
                    value={formData.vat_number}
                    onChange={(e) => setFormData({ ...formData, vat_number: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Payment Terms (days)
                  </label>
                  <Input
                    type="number"
                    value={formData.payment_terms}
                    onChange={(e) => setFormData({ ...formData, payment_terms: parseInt(e.target.value) || 30 })}
                    min="0"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium mb-1">
                    Address
                  </label>
                  <Textarea
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    rows={3}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium mb-1">
                    Notes
                  </label>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                  />
                </div>
              </div>
        </form>
      </Modal>
    </Page>
  )
}