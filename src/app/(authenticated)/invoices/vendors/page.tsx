'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getVendors, createVendor, updateVendor, deleteVendor } from '@/app/actions/vendors'
import {
  PageLayout,
  PageLoading,
  Icon,
  Button,
  IconButton,
  Modal,
  Input,
  Textarea,
  Field,
  Card,
  Checkbox,
  Alert,
  Badge,
  Empty,
  DataTable,
  ConfirmDialog,
  FormFooter,
} from '@/ds'
import { getVendorContacts, createVendorContact, updateVendorContact, deleteVendorContact } from '@/app/actions/vendor-contacts'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { usePermissions } from '@/contexts/PermissionContext'
import { FINANCE_NAV } from '../_shared/nav'
import { VENDOR_CONTACT_FLAG_TONE } from '../_shared/status-ui'

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
        <div className="text-text-muted break-all">{primary.email}</div>
      </div>
    )
  }
  // Fallback to legacy vendor fields
  return (
    <div className="text-sm">
      <div className="font-medium truncate">{vendor.contact_name || '(No primary set)'}</div>
      <div className="text-text-muted break-all">{vendor.email || '-'}</div>
    </div>
  )
}
import type { InvoiceVendor } from '@/types/invoices'
import { DEFAULT_PAYMENT_TERMS_DAYS } from '@/lib/vendors/paymentTerms'

interface VendorContact {
  id: string
  name: string
  email: string | null
  phone?: string | null
  role?: string | null
  is_primary: boolean
  receive_invoice_copy?: boolean | null
}

interface VendorFormData {
  name: string
  phone: string
  address: string
  vat_number: string
  payment_terms: number
  notes: string
  paypal_payments_enabled: boolean
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
    payment_terms: DEFAULT_PAYMENT_TERMS_DAYS,
    notes: '',
    paypal_payments_enabled: false,
  })
  const [formLoading, setFormLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [contactsModalVendor, setContactsModalVendor] = useState<InvoiceVendor | null>(null)
  const [contacts, setContacts] = useState<VendorContact[]>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  // A failed contacts load is kept apart from a failed save, so it is never drawn as "No contacts yet".
  const [contactsLoadError, setContactsLoadError] = useState<string | null>(null)
  const [contactForm, setContactForm] = useState<{ id?: string, name: string, email: string, phone: string, role: string, is_primary: boolean, receive_invoice_copy: boolean }>({
    name: '',
    email: '',
    phone: '',
    role: '',
    is_primary: false,
    receive_invoice_copy: false,
  })
  const [contactSaving, setContactSaving] = useState(false)
  // A failed load is kept apart from a failed save or delete, so it is never drawn as an empty list.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<InvoiceVendor | null>(null)

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
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load vendors')
    } finally {
      setLoading(false)
    }
  }

  async function openContacts(vendor: InvoiceVendor) {
    setContactsModalVendor(vendor)
    setContactsLoading(true)
    setError(null)
    setContactsLoadError(null)
    try {
      const res = await getVendorContacts(vendor.id)
      if (res.error) throw new Error(res.error)
      setContacts(res.contacts || [])
    } catch (err) {
      setContactsLoadError(err instanceof Error ? err.message : 'Failed to load contacts')
    } finally {
      setContactsLoading(false)
    }
  }

  function closeContacts() {
    setContactsModalVendor(null)
    setContacts([])
    setContactsLoadError(null)
    setContactForm({ name: '', email: '', phone: '', role: '', is_primary: false, receive_invoice_copy: false })
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
      fd.append('phone', contactForm.phone)
      fd.append('role', contactForm.role)
      fd.append('isPrimary', String(contactForm.is_primary))
      fd.append('receiveInvoiceCopy', String(contactForm.receive_invoice_copy))
      if (contactForm.id) fd.append('id', contactForm.id)

      const res = contactForm.id ? await updateVendorContact(fd) : await createVendorContact(fd)
      if (res.error) throw new Error(res.error)
      // refresh list
      const list = await getVendorContacts(contactsModalVendor.id)
      if (!list.error) {
        setContacts(list.contacts || [])
        setContactsLoadError(null)
      }
      setContactForm({ name: '', email: '', phone: '', role: '', is_primary: false, receive_invoice_copy: false })
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
        if (!list.error) {
          setContacts(list.contacts || [])
          setContactsLoadError(null)
        }
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
        payment_terms: vendor.payment_terms ?? DEFAULT_PAYMENT_TERMS_DAYS,
        notes: vendor.notes || '',
        paypal_payments_enabled: vendor.paypal_payments_enabled === true,
      })
    } else {
      setEditingVendor(null)
      setFormData({
        name: '',
        phone: '',
        address: '',
        vat_number: '',
        payment_terms: DEFAULT_PAYMENT_TERMS_DAYS,
        notes: '',
        paypal_payments_enabled: false,
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

  function requestDelete(vendor: InvoiceVendor) {
    if (!canDelete) {
      setError('You do not have permission to delete vendors')
      return
    }
    setDeleteTarget(vendor)
  }

  async function handleDelete(vendor: InvoiceVendor) {
    if (!canDelete) {
      setError('You do not have permission to delete vendors')
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

  const layoutProps = {
    title: 'Invoices',
    subtitle: 'Vendors who receive invoices and quotes',
    navItems: FINANCE_NAV,
  }

  if (permissionsLoading || loading) {
    return <PageLayout {...layoutProps} loading loadingLabel="Loading vendors" />
  }

  if (!canView) {
    return null
  }

  const editButton = (v: InvoiceVendor) => (
    <IconButton
      size="sm"
      variant="secondary"
      onClick={() => openForm(v)}
      label="Edit vendor"
      icon={<Icon name="edit" size={16} />}
      disabled={!canEdit}
      title={!canEdit ? 'You need invoice edit permission to update vendors.' : undefined}
    />
  )

  const deleteButton = (v: InvoiceVendor) => (
    <IconButton
      size="sm"
      variant="danger"
      onClick={() => requestDelete(v)}
      label="Delete vendor"
      icon={<Icon name="trash" size={16} />}
      disabled={!canDelete}
      title={!canDelete ? 'You need invoice delete permission to remove vendors.' : undefined}
    />
  )

  // While a dialog is open its own error banner shows the message, not the page behind it.
  const dialogOpen = showForm || contactsModalVendor !== null

  return (
    <PageLayout
      {...layoutProps}
      headerActions={
        canCreate ? (
          <Button variant="primary"
            size="sm"
            onClick={() => openForm()}
            leftIcon={<Icon name="plus" size={16} />}
          >
            Add Vendor
          </Button>
        ) : undefined
      }
    >
      {isReadOnly && (
        <Alert tone="info">
          You have read-only access to vendors. Create, edit, delete, and contact management actions are disabled.
        </Alert>
      )}
      {error && !dialogOpen && <Alert tone="danger">{error}</Alert>}

      {loadError ? (
        <Alert tone="danger" title="Could not load vendors">{loadError}</Alert>
      ) : (
        <Card padding="none">
          <DataTable<InvoiceVendor>
            data={vendors}
            getRowKey={(v) => v.id}
            bordered={false}
            emptyMessage="No vendors found"
            emptyDescription="Add your first vendor to get started."
            columns={[
              { key: 'name', header: 'Name', cell: (v: InvoiceVendor) => (
                <div>
                  <div className="font-medium">{v.name}</div>
                  {v.vat_number && (<div className="text-sm text-text-muted">VAT: {v.vat_number}</div>)}
                </div>
              ) },
              { key: 'primary_contact', header: 'Primary Contact', cell: (v: InvoiceVendor) => (
                <PrimaryContactCell vendor={v} />
              ) },
              { key: 'terms', header: 'Payment Terms', cell: (v: InvoiceVendor) => <span className="text-sm">{v.payment_terms} days</span> },
              { key: 'actions', header: 'Actions', align: 'right', cell: (v: InvoiceVendor) => (
                <div className="flex justify-end gap-2">
                  <Button variant="secondary"
                    size="sm"
                    onClick={() => openContacts(v)}
                    aria-label="Manage contacts"
                    leftIcon={<Icon name="users" size={16} />}
                  >
                    Contacts
                  </Button>
                  {editButton(v)}
                  {deleteButton(v)}
                </div>
              ) },
            ]}
            renderMobileCard={(v: InvoiceVendor) => (
              <div className="space-y-3 border-b border-border p-pad-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{v.name}</div>
                    {v.vat_number && (<div className="text-sm text-text-muted">VAT: {v.vat_number}</div>)}
                    <div className="text-sm text-text-muted break-all">{v.email || '-'}</div>
                    {v.phone && (<div className="text-sm text-text-muted">{v.phone}</div>)}
                    <div className="mt-1 text-sm text-text-muted">Terms: {v.payment_terms} days</div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {editButton(v)}
                    {deleteButton(v)}
                  </div>
                </div>
                <Button variant="secondary"
                  size="sm"
                  fullWidth
                  onClick={() => openContacts(v)}
                  aria-label="Manage contacts"
                  leftIcon={<Icon name="users" size={16} />}
                >
                  Contacts
                </Button>
              </div>
            )}
          />
        </Card>
      )}

      <Modal
        open={showForm}
        onClose={closeForm}
        title={editingVendor ? 'Edit Vendor' : 'Add New Vendor'}
        width="lg"
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
              form="vendor-form"
              disabled={
                formLoading ||
                (editingVendor ? !canEdit : !canCreate)
              }
              loading={formLoading}
            >
              {editingVendor ? 'Update' : 'Create'} Vendor
            </Button>
          </>
        }
      >
        <form id="vendor-form" onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Company Name" required className="sm:col-span-2">
              <Input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </Field>

            <div className="sm:col-span-2">
              <Alert tone="info" title="Contacts moved">
                Manage people and email recipients via the Contacts button above. The vendor’s default email remains visible in the list for legacy invoices.
              </Alert>
            </div>

            <Input
              label="Phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />

            <Input
              label="VAT Number"
              type="text"
              value={formData.vat_number}
              onChange={(e) => setFormData({ ...formData, vat_number: e.target.value })}
            />

            <Input
              label="Payment Terms (days)"
              type="number"
              value={formData.payment_terms}
              onChange={(e) => {
                const nextValue = Number.isNaN(e.target.valueAsNumber) ? 0 : e.target.valueAsNumber
                setFormData({ ...formData, payment_terms: nextValue })
              }}
              min="0"
            />

            <div className="sm:col-span-2">
              <Checkbox
                checked={formData.paypal_payments_enabled}
                onChange={(checked: boolean) =>
                  setFormData({ ...formData, paypal_payments_enabled: checked })
                }
                label="Offer PayPal/card payment"
                description="Adds a secure online payment link to this vendor's invoice emails."
              />
            </div>

            <div className="sm:col-span-2">
              <Textarea
                label="Address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                rows={3}
              />
            </div>

            <div className="sm:col-span-2">
              <Textarea
                label="Notes"
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
        title={contactsModalVendor ? `Contacts for ${contactsModalVendor.name}` : 'Contacts'}
        width="lg"
      >
        {contactsLoading ? (
          <PageLoading inline label="Loading contacts" />
        ) : (
          <div className="space-y-4">
            {error && <Alert tone="danger">{error}</Alert>}
            {contactsLoadError ? (
              <Alert tone="danger" title="Could not load contacts">{contactsLoadError}</Alert>
            ) : (
              <Card padding="none">
                {contacts.length === 0 ? (
                  <Empty size="sm" title="No contacts yet" />
                ) : (
                  <div className="divide-y divide-border">
                    {contacts.map(c => (
                      <div key={c.id} className="p-4 flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="font-medium truncate">
                            {c.name || '(No name)'}
                            {c.is_primary && (
                              <Badge tone={VENDOR_CONTACT_FLAG_TONE.primary} className="ml-2">
                                Primary
                              </Badge>
                            )}
                            {c.receive_invoice_copy && (
                              <Badge tone={VENDOR_CONTACT_FLAG_TONE.invoiceCc} className="ml-2">
                                Invoice CC
                              </Badge>
                            )}
                          </div>
                          <div className="text-sm text-text break-all">{c.email}</div>
                          {(c.phone || c.role) && (
                            <div className="text-xs text-text-muted mt-1">
                              {c.role ? <span className="mr-3">Role: {c.role}</span> : null}
                              {c.phone ? <span>Phone: {c.phone}</span> : null}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setContactForm({
                              id: c.id,
                              name: c.name || '',
                              email: c.email || '',
                              phone: c.phone || '',
                              role: c.role || '',
                              is_primary: c.is_primary,
                              receive_invoice_copy: !!c.receive_invoice_copy,
                            })}
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
                )}
              </Card>
            )}

            {!canEdit && (
              <Alert tone="info">
                You have read-only access to contacts. Editing and adding contacts is disabled.
              </Alert>
            )}
            <form onSubmit={saveContact} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Name">
                  <Input
                    value={contactForm.name}
                    onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                    disabled={!canEdit}
                  />
                </Field>
                <Field label="Email" required>
                  <Input
                    type="email"
                    required
                    value={contactForm.email}
                    onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                    disabled={!canEdit}
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    value={contactForm.phone}
                    onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                    disabled={!canEdit}
                  />
                </Field>
                <Field label="Role">
                  <Input
                    value={contactForm.role}
                    onChange={(e) => setContactForm({ ...contactForm, role: e.target.value })}
                    disabled={!canEdit}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Checkbox
                    checked={contactForm.is_primary}
                    onChange={(checked: boolean) => setContactForm({ ...contactForm, is_primary: checked })}
                    disabled={!canEdit}
                    label="Set as primary contact"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Checkbox
                    checked={contactForm.receive_invoice_copy}
                    onChange={(checked: boolean) => setContactForm({ ...contactForm, receive_invoice_copy: checked })}
                    disabled={!canEdit}
                    label="Receive invoice copy (CC)"
                  />
                </div>
              </div>
              <FormFooter>
                <Button variant="primary"
                  type="submit"
                  loading={contactSaving}
                  disabled={!canEdit || contactSaving}
                >
                  {contactForm.id ? 'Update Contact' : 'Add Contact'}
                </Button>
              </FormFooter>
            </form>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) await handleDelete(deleteTarget)
        }}
        title="Delete Vendor"
        message={deleteTarget ? `Are you sure you want to delete ${deleteTarget.name}? This action cannot be undone.` : undefined}
        confirmLabel="Delete"
        tone="danger"
      />
    </PageLayout>
  )
}
