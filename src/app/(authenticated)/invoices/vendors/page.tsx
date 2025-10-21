'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getVendors, createVendor, updateVendor, deleteVendor } from '@/app/actions/vendors'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Button } from '@/components/ui-v2/forms/Button'
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup'
import { NavLink } from '@/components/ui-v2/navigation/NavLink'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { Input } from '@/components/ui-v2/forms/Input'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Card } from '@/components/ui-v2/layout/Card'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { Plus, Edit2, Trash2, Users } from 'lucide-react'
import { getVendorContacts, createVendorContact, updateVendorContact, deleteVendorContact } from '@/app/actions/vendor-contacts'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { usePermissions } from '@/contexts/PermissionContext'

function PrimaryContactCell({ vendor }: { vendor: InvoiceVendor }) {
  const supabase = useSupabase()
  const [primary, setPrimary] = useState<{ name: string | null, email: string } | null>(null)
  useEffect(() => {
    let active = true
    async function load() {
      const { data } = await supabase
        .from('invoice_vendor_contacts')
        .select('name, email')
        .eq('vendor_id', vendor.id)
        .eq('is_primary', true)
        .maybeSingle()
      if (!active) return
      if (data) {
        const typed = data as { name: string | null; email: string | null }
        setPrimary({ name: typed.name || null, email: typed.email || '' })
      }
    }
    load()
    return () => { active = false }
  }, [supabase, vendor.id])

  if (primary) {
    return (
      <div className="text-sm">
        <div className="font-medium truncate">{primary.name || '(No name)'}</div>
        <div className="text-gray-600 break-all">{primary.email}</div>
      </div>
    )
  }
  // Fallback to legacy vendor fields
  return (
    <div className="text-sm">
      <div className="font-medium truncate">{vendor.contact_name || '(No primary set)'}</div>
      <div className="text-gray-600 break-all">{vendor.email || '-'}</div>
    </div>
  )
}
import type { InvoiceVendor } from '@/types/invoices'

interface VendorContact {
  id: string
  name: string
  email: string | null
  is_primary: boolean
}

interface VendorFormData {
  name: string
  phone: string
  address: string
  vat_number: string
  payment_terms: number
  notes: string
}

export default function VendorsPage() {
  const router = useRouter()
  const { hasPermission, loading: permissionsLoading } = usePermissions()
  const canView = hasPermission('invoices', 'view')
  const canCreate = hasPermission('invoices', 'create')
  const canEdit = hasPermission('invoices', 'edit')
  const canDelete = hasPermission('invoices', 'delete')
  const isReadOnly = canView && !canCreate && !canEdit && !canDelete

  const [vendors, setVendors] = useState<InvoiceVendor[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingVendor, setEditingVendor] = useState<InvoiceVendor | null>(null)
  const [formData, setFormData] = useState<VendorFormData>({
    name: '',
    phone: '',
    address: '',
    vat_number: '',
    payment_terms: 30,
    notes: ''
  })
  const [formLoading, setFormLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [contactsModalVendor, setContactsModalVendor] = useState<InvoiceVendor | null>(null)
  const [contacts, setContacts] = useState<VendorContact[]>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const [contactForm, setContactForm] = useState<{ id?: string, name: string, email: string, is_primary: boolean }>({ name: '', email: '', is_primary: false })
  const [contactSaving, setContactSaving] = useState(false)

  useEffect(() => {
    if (permissionsLoading) {
      return
    }

    if (!canView) {
      router.replace('/unauthorized')
      return
    }

    loadVendors()
  }, [permissionsLoading, canView, router])

  async function loadVendors() {
    if (!canView) {
      return
    }

    setLoading(true)
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

  async function openContacts(vendor: InvoiceVendor) {
    setContactsModalVendor(vendor)
    setContactsLoading(true)
    setError(null)
    try {
      const res = await getVendorContacts(vendor.id)
      if (res.error) throw new Error(res.error)
      setContacts(res.contacts || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contacts')
    } finally {
      setContactsLoading(false)
    }
  }

  function closeContacts() {
    setContactsModalVendor(null)
    setContacts([])
    setContactForm({ name: '', email: '', is_primary: false })
    setError(null)
  }

  async function saveContact(e: React.FormEvent) {
    e.preventDefault()
    if (!contactsModalVendor) return
    if (!canEdit) {
      setError('You do not have permission to manage vendor contacts')
      return
    }
    setContactSaving(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('vendorId', contactsModalVendor.id)
      fd.append('name', contactForm.name)
      fd.append('email', contactForm.email)
      fd.append('isPrimary', String(contactForm.is_primary))
      if (contactForm.id) fd.append('id', contactForm.id)

      const res = contactForm.id ? await updateVendorContact(fd) : await createVendorContact(fd)
      if (res.error) throw new Error(res.error)
      // refresh list
      const list = await getVendorContacts(contactsModalVendor.id)
      if (!list.error) setContacts(list.contacts || [])
      setContactForm({ name: '', email: '', is_primary: false })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save contact')
    } finally {
      setContactSaving(false)
    }
  }

  async function removeContact(id: string) {
    if (!canEdit) {
      setError('You do not have permission to manage vendor contacts')
      return
    }
    try {
      const fd = new FormData()
      fd.append('id', id)
      const res = await deleteVendorContact(fd)
      if (res.error) throw new Error(res.error)
      if (contactsModalVendor) {
        const list = await getVendorContacts(contactsModalVendor.id)
        if (!list.error) setContacts(list.contacts || [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete contact')
    }
  }

  function openForm(vendor?: InvoiceVendor) {
    if (vendor) {
      if (!canEdit) {
        setError('You do not have permission to edit vendors')
        return
      }
    } else if (!canCreate) {
      setError('You do not have permission to create vendors')
      return
    }

    if (vendor) {
      setEditingVendor(vendor)
      setFormData({
        name: vendor.name,
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
    if (editingVendor) {
      if (!canEdit) {
        setError('You do not have permission to edit vendors')
        return
      }
    } else if (!canCreate) {
      setError('You do not have permission to create vendors')
      return
    }
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
    if (!canDelete) {
      setError('You do not have permission to delete vendors')
      return
    }

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

  if (permissionsLoading || loading) {
    return (
      <PageLayout
        title="Vendors"
        subtitle="Manage your invoice vendors"
        backButton={{ label: 'Back to Invoices', href: '/invoices' }}
        loading
        loadingLabel="Loading vendors..."
      />
    )
  }

  if (!canView) {
    return null
  }

  return (
    <PageLayout
      title="Vendors"
      subtitle="Manage your invoice vendors"
      backButton={{ label: 'Back to Invoices', href: '/invoices' }}
      navActions={
        <NavGroup>
          <NavLink
            onClick={canCreate ? () => openForm() : undefined}
            disabled={!canCreate}
            title={!canCreate ? 'You need invoice create permission to add vendors.' : undefined}
            className="font-semibold"
          >
            <Plus className="h-4 w-4" />
            Add Vendor
          </NavLink>
        </NavGroup>
      }
    >
      <div className="space-y-6">
      {isReadOnly && (
        <Alert
          variant="info"
          description="You have read-only access to vendors. Create, edit, delete, and contact management actions are disabled."
          className="mb-6"
        />
      )}
      {error && (
        <Alert variant="error" description={error} className="mb-6" />
      )}

      {vendors.length === 0 ? (
        <EmptyState
          title="No vendors found"
          description="Add your first vendor to get started."
          action={
            canCreate ? (
              <Button onClick={() => openForm()} leftIcon={<Plus className="h-4 w-4" />}>
                Add Your First Vendor
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <DataTable<InvoiceVendor>
            data={vendors}
            getRowKey={(v) => v.id}
            emptyMessage="No vendors found"
            columns={[
              { key: 'name', header: 'Name', cell: (v: InvoiceVendor) => (
                <div>
                  <div className="font-medium">{v.name}</div>
                  {v.vat_number && (<div className="text-sm text-gray-500">VAT: {v.vat_number}</div>)}
                </div>
              ) },
              { key: 'primary_contact', header: 'Primary Contact', cell: (v: InvoiceVendor) => (
                <PrimaryContactCell vendor={v} />
              ) },
              { key: 'terms', header: 'Payment Terms', cell: (v: InvoiceVendor) => <span className="text-sm">{v.payment_terms} days</span> },
              { key: 'actions', header: 'Actions', align: 'right', cell: (v: InvoiceVendor) => (
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    onClick={() => openContacts(v)}
                    aria-label="Manage contacts"
                    leftIcon={<Users className="h-4 w-4" />}
                  >
                    Contacts
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openForm(v)}
                    aria-label="Edit vendor"
                    iconOnly
                    disabled={!canEdit}
                    title={!canEdit ? 'You need invoice edit permission to update vendors.' : undefined}
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => handleDelete(v)}
                    aria-label="Delete vendor"
                    iconOnly
                    disabled={!canDelete}
                    title={!canDelete ? 'You need invoice delete permission to remove vendors.' : undefined}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ) },
            ]}
            renderMobileCard={(v: InvoiceVendor) => (
              <div className="p-3">
                <div className="flex justify-between items-start mb-2">
                  <div className="min-w-0">
                    <div className="font-medium">{v.name}</div>
                    {v.vat_number && (<div className="text-sm text-gray-500">VAT: {v.vat_number}</div>)}
                    <div className="text-sm text-gray-600">{v.email || '-'}</div>
                    {v.phone && (<div className="text-sm text-gray-600">{v.phone}</div>)}
                  </div>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <div>Terms: {v.payment_terms} days</div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openForm(v)}
                      aria-label="Edit vendor"
                      iconOnly
                      disabled={!canEdit}
                      title={!canEdit ? 'You need invoice edit permission to update vendors.' : undefined}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleDelete(v)}
                      aria-label="Delete vendor"
                      iconOnly
                      disabled={!canDelete}
                      title={!canDelete ? 'You need invoice delete permission to remove vendors.' : undefined}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          />
        </Card>
      )}

      </div>

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
              disabled={
                formLoading ||
                (editingVendor ? !canEdit : !canCreate)
              }
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

                <div className="md:col-span-2">
                  <Alert variant="info" title="Contacts moved">
                    Manage people and email recipients via the Contacts button above. The vendor’s default email remains visible in the list for legacy invoices.
                  </Alert>
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

      {/* Contacts Manager */}
      <Modal
        open={!!contactsModalVendor}
        onClose={closeContacts}
        title={contactsModalVendor ? `Contacts — ${contactsModalVendor.name}` : 'Contacts'}
        size="lg"
      >
        {error && (
          <Alert variant="error" description={error} className="mb-4" />)
        }
        {contactsLoading ? (
          <div className="py-10 text-center text-gray-600">Loading contacts…</div>
        ) : (
          <div className="space-y-6">
            <div className="border rounded-md divide-y">
              {contacts.length === 0 && (
                <div className="p-4 text-sm text-gray-600">No contacts yet.</div>
              )}
              {contacts.map(c => (
                <div key={c.id} className="p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{c.name || '(No name)'} {c.is_primary && <span className="ml-2 text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded">Primary</span>}</div>
                    <div className="text-sm text-gray-700 break-all">{c.email}</div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setContactForm({ id: c.id, name: c.name || '', email: c.email || '', is_primary: c.is_primary })}
                      disabled={!canEdit}
                      title={!canEdit ? 'You need invoice edit permission to modify contacts.' : undefined}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => removeContact(c.id)}
                      disabled={!canEdit}
                      title={!canEdit ? 'You need invoice edit permission to modify contacts.' : undefined}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {!canEdit && (
              <Alert
                variant="info"
                description="You have read-only access to contacts. Editing and adding contacts is disabled."
              />
            )}
            <form onSubmit={saveContact} className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <FormGroup label="Name">
                  <Input
                    value={contactForm.name}
                    onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                    disabled={!canEdit}
                  />
                </FormGroup>
                <FormGroup label="Email" required>
                  <Input
                    type="email"
                    required
                    value={contactForm.email}
                    onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                    disabled={!canEdit}
                  />
                </FormGroup>
                <label className="inline-flex items-center gap-2 md:col-span-2 text-sm">
                  <input
                    type="checkbox"
                    checked={contactForm.is_primary}
                    onChange={(e) => setContactForm({ ...contactForm, is_primary: e.target.checked })}
                    disabled={!canEdit}
                  />
                  Set as primary contact
                </label>
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  loading={contactSaving}
                  disabled={!canEdit || contactSaving}
                >
                  {contactForm.id ? 'Update Contact' : 'Add Contact'}
                </Button>
              </div>
            </form>
          </div>
        )}
      </Modal>
    </PageLayout>
  )
}
