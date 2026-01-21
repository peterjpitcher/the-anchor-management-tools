'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card, CardTitle } from '@/components/ui-v2/layout/Card'
import { Button, IconButton } from '@/components/ui-v2/forms/Button'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { usePermissions } from '@/contexts/PermissionContext'
import { createVendor, getVendors } from '@/app/actions/vendors'
import { getVendorBillingSettings, upsertVendorBillingSettings } from '@/app/actions/oj-projects/vendor-settings'
import { getOjProjectsEmailStatus } from '@/app/actions/oj-projects/system'
import {
  createRecurringCharge,
  disableRecurringCharge,
  getRecurringCharges,
  updateRecurringCharge,
} from '@/app/actions/oj-projects/recurring-charges'
import { createVendorContact, deleteVendorContact, getVendorContacts, updateVendorContact } from '@/app/actions/vendor-contacts'
import type { InvoiceVendor } from '@/types/invoices'
import {
  AlertCircle,
  Briefcase,
  Building2,
  Check,
  CreditCard,
  LayoutDashboard,
  List,
  Mail,
  Phone,
  Plus,
  Save,
  Settings,
  Trash2,
  User,
  Users
} from 'lucide-react'

type SettingsFormState = {
  vendor_id: string
  client_code: string
  billing_mode: 'full' | 'cap'
  monthly_cap_inc_vat: string
  hourly_rate_ex_vat: string
  vat_rate: string
  mileage_rate: string
  retainer_included_hours_per_month: string
}

type ChargeFormState = {
  id?: string
  description: string
  amount_ex_vat: string
  vat_rate: string
  is_active: boolean
  sort_order: string
}

type VendorContact = {
  id: string
  name: string | null
  email: string | null
  phone?: string | null
  role?: string | null
  is_primary: boolean
  receive_invoice_copy?: boolean | null
}

type ContactFormState = {
  id?: string
  name: string
  email: string
  phone: string
  role: string
  is_primary: boolean
  receive_invoice_copy: boolean
}

export default function OJProjectsClientsPage() {
  const router = useRouter()
  const { hasPermission, loading: permissionsLoading } = usePermissions()

  const canView = hasPermission('oj_projects', 'view')
  const canEditSettings = hasPermission('oj_projects', 'edit')
  const canCreateVendor = hasPermission('invoices', 'create')
  const canEditContacts = hasPermission('invoices', 'edit')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [vendors, setVendors] = useState<InvoiceVendor[]>([])
  const [vendorId, setVendorId] = useState('')
  const [emailStatus, setEmailStatus] = useState<{ configured: boolean; senderEmail: string | null } | null>(null)

  const selectedVendor = useMemo(() => vendors.find((v) => v.id === vendorId) || null, [vendors, vendorId])

  const [settings, setSettings] = useState<SettingsFormState>({
    vendor_id: '',
    client_code: '',
    billing_mode: 'full',
    monthly_cap_inc_vat: '',
    hourly_rate_ex_vat: '75',
    vat_rate: '20',
    mileage_rate: '0.42',
    retainer_included_hours_per_month: '',
  })

  const [charges, setCharges] = useState<any[]>([])
  const [contacts, setContacts] = useState<VendorContact[]>([])

  const invoiceRecipientConfigured = useMemo(() => {
    const vendorEmails = String(selectedVendor?.email || '')
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter((s) => s && s.includes('@'))

    const primaryContactEmail = contacts.find((c) => c.is_primary && c.email && String(c.email).includes('@'))?.email
    const anyContactEmail = contacts.find((c) => c.email && String(c.email).includes('@'))?.email

    return Boolean(primaryContactEmail || vendorEmails[0] || anyContactEmail)
  }, [selectedVendor?.email, contacts])

  const recurringChargesIncVat = useMemo(() => {
    return (charges || [])
      .filter((c: any) => c?.is_active !== false)
      .reduce((acc: number, c: any) => {
        const exVat = Number(c.amount_ex_vat || 0)
        const vatRate = Number(c.vat_rate || 0)
        return acc + exVat + exVat * (vatRate / 100)
      }, 0)
  }, [charges])

  const capMisconfigured = useMemo(() => {
    if (settings.billing_mode !== 'cap') return false
    const cap = Number.parseFloat(settings.monthly_cap_inc_vat || '')
    if (!Number.isFinite(cap) || cap <= 0) return false
    return recurringChargesIncVat > cap
  }, [settings.billing_mode, settings.monthly_cap_inc_vat, recurringChargesIncVat])

  const [savingSettings, setSavingSettings] = useState(false)

  const [chargeSaving, setChargeSaving] = useState(false)
  const [chargeForm, setChargeForm] = useState<ChargeFormState>({
    description: '',
    amount_ex_vat: '',
    vat_rate: '20',
    is_active: true,
    sort_order: '0',
  })

  const [contactSaving, setContactSaving] = useState(false)
  const [contactForm, setContactForm] = useState<ContactFormState>({
    name: '',
    email: '',
    phone: '',
    role: '',
    is_primary: false,
    receive_invoice_copy: false,
  })

  const [vendorModalOpen, setVendorModalOpen] = useState(false)
  const [vendorSaving, setVendorSaving] = useState(false)
  const [vendorForm, setVendorForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    payment_terms: '30',
    notes: '',
  })

  useEffect(() => {
    if (permissionsLoading) return
    if (!canView) {
      router.replace('/unauthorized')
      return
    }
    loadVendors()
  }, [permissionsLoading, canView])

  useEffect(() => {
    if (!vendorId) return
    loadVendorDetails(vendorId)
  }, [vendorId])

  async function loadVendors() {
    setLoading(true)
    setError(null)
    try {
      const [res, emailRes] = await Promise.all([getVendors(), getOjProjectsEmailStatus()])

      if (res.error || !res.vendors) throw new Error(res.error || 'Failed to load clients')
      setVendors(res.vendors)
      if (!vendorId && res.vendors.length > 0) {
        setVendorId(res.vendors[0].id)
      }

      if (!emailRes.error) {
        setEmailStatus({
          configured: !!(emailRes as any).configured,
          senderEmail: (emailRes as any).senderEmail ?? null,
        })
      } else {
        setEmailStatus(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clients')
      setEmailStatus(null)
    } finally {
      setLoading(false)
    }
  }

  async function loadVendorDetails(id: string) {
    setLoading(true)
    setError(null)
    try {
      const [settingsRes, chargesRes, contactsRes] = await Promise.all([
        getVendorBillingSettings(id),
        getRecurringCharges(id),
        getVendorContacts(id),
      ])

      if (settingsRes.error) throw new Error(settingsRes.error)
      if (chargesRes.error) throw new Error(chargesRes.error)
      if (contactsRes.error) throw new Error(contactsRes.error)

      const s = settingsRes.settings
      setSettings({
        vendor_id: id,
        client_code: s?.client_code || '',
        billing_mode: (s?.billing_mode as any) || 'full',
        monthly_cap_inc_vat: s?.monthly_cap_inc_vat != null ? String(s.monthly_cap_inc_vat) : '',
        hourly_rate_ex_vat: s?.hourly_rate_ex_vat != null ? String(s.hourly_rate_ex_vat) : '75',
        vat_rate: s?.vat_rate != null ? String(s.vat_rate) : '20',
        mileage_rate: s?.mileage_rate != null ? String(s.mileage_rate) : '0.42',
        retainer_included_hours_per_month:
          s?.retainer_included_hours_per_month != null ? String(s.retainer_included_hours_per_month) : '',
      })

      setCharges(chargesRes.charges || [])
      setContacts((contactsRes.contacts as VendorContact[]) || [])
      setChargeForm({ description: '', amount_ex_vat: '', vat_rate: '20', is_active: true, sort_order: '0' })
      setContactForm({ name: '', email: '', phone: '', role: '', is_primary: false, receive_invoice_copy: false })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load client settings')
    } finally {
      setLoading(false)
    }
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault()
    if (!vendorId) return
    if (!canEditSettings) {
      toast.error('You do not have permission to edit client settings')
      return
    }

    setSavingSettings(true)
    try {
      const fd = new FormData()
      fd.append('vendor_id', vendorId)
      fd.append('client_code', settings.client_code)
      fd.append('billing_mode', settings.billing_mode)
      fd.append('monthly_cap_inc_vat', settings.monthly_cap_inc_vat)
      fd.append('hourly_rate_ex_vat', settings.hourly_rate_ex_vat)
      fd.append('vat_rate', settings.vat_rate)
      fd.append('mileage_rate', settings.mileage_rate)
      fd.append('retainer_included_hours_per_month', settings.retainer_included_hours_per_month)

      const res = await upsertVendorBillingSettings(fd)
      if (res.error) throw new Error(res.error)
      toast.success('Client settings saved')
      await loadVendorDetails(vendorId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save client settings')
    } finally {
      setSavingSettings(false)
    }
  }

  async function saveCharge(e: React.FormEvent) {
    e.preventDefault()
    if (!vendorId) return
    if (!canEditSettings) {
      toast.error('You do not have permission to manage recurring charges')
      return
    }

    setChargeSaving(true)
    try {
      const fd = new FormData()
      fd.append('vendor_id', vendorId)
      fd.append('description', chargeForm.description)
      fd.append('amount_ex_vat', chargeForm.amount_ex_vat)
      fd.append('vat_rate', chargeForm.vat_rate)
      fd.append('is_active', String(chargeForm.is_active))
      fd.append('sort_order', chargeForm.sort_order)
      if (chargeForm.id) fd.append('id', chargeForm.id)

      const res = chargeForm.id ? await updateRecurringCharge(fd) : await createRecurringCharge(fd)
      if (res.error) throw new Error(res.error)

      toast.success(chargeForm.id ? 'Recurring charge updated' : 'Recurring charge added')
      await loadVendorDetails(vendorId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save recurring charge')
    } finally {
      setChargeSaving(false)
    }
  }

  async function disableCharge(id: string) {
    if (!vendorId) return
    if (!canEditSettings) {
      toast.error('You do not have permission to manage recurring charges')
      return
    }
    if (!window.confirm('Disable this recurring charge?')) return

    try {
      const fd = new FormData()
      fd.append('id', id)
      const res = await disableRecurringCharge(fd)
      if (res.error) throw new Error(res.error)
      toast.success('Recurring charge disabled')
      await loadVendorDetails(vendorId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disable recurring charge')
    }
  }

  async function saveContact(e: React.FormEvent) {
    e.preventDefault()
    if (!vendorId) return
    if (!canEditContacts) {
      toast.error('You do not have permission to manage invoice contacts')
      return
    }

    setContactSaving(true)
    try {
      const fd = new FormData()
      fd.append('vendorId', vendorId)
      fd.append('name', contactForm.name)
      fd.append('email', contactForm.email)
      fd.append('phone', contactForm.phone)
      fd.append('role', contactForm.role)
      fd.append('isPrimary', String(contactForm.is_primary))
      fd.append('receiveInvoiceCopy', String(contactForm.receive_invoice_copy))
      if (contactForm.id) fd.append('id', contactForm.id)

      const res = contactForm.id ? await updateVendorContact(fd) : await createVendorContact(fd)
      if (res.error) throw new Error(res.error)
      toast.success(contactForm.id ? 'Contact updated' : 'Contact added')
      await loadVendorDetails(vendorId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save contact')
    } finally {
      setContactSaving(false)
    }
  }

  async function removeContact(id: string) {
    if (!vendorId) return
    if (!canEditContacts) {
      toast.error('You do not have permission to manage invoice contacts')
      return
    }
    if (!window.confirm('Delete this contact?')) return

    try {
      const fd = new FormData()
      fd.append('id', id)
      const res = await deleteVendorContact(fd)
      if (res.error) throw new Error(res.error)
      toast.success('Contact deleted')
      await loadVendorDetails(vendorId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete contact')
    }
  }

  function openCreateVendor() {
    if (!canCreateVendor) {
      toast.error('You do not have permission to create clients')
      return
    }
    setVendorForm({ name: '', email: '', phone: '', address: '', payment_terms: '30', notes: '' })
    setVendorModalOpen(true)
  }

  async function createNewVendor(e: React.FormEvent) {
    e.preventDefault()
    if (!canCreateVendor) return

    setVendorSaving(true)
    try {
      const fd = new FormData()
      fd.append('name', vendorForm.name)
      fd.append('email', vendorForm.email)
      fd.append('phone', vendorForm.phone)
      fd.append('address', vendorForm.address)
      fd.append('payment_terms', vendorForm.payment_terms)
      fd.append('notes', vendorForm.notes)

      const res = await createVendor(fd)
      if (res.error) throw new Error(res.error)

      toast.success('Client created')
      setVendorModalOpen(false)
      await loadVendors()
      if ((res as any).vendor?.id) {
        setVendorId((res as any).vendor.id)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create client')
    } finally {
      setVendorSaving(false)
    }
  }

  if (permissionsLoading || loading) {
    return <PageLayout title="Clients" subtitle="OJ Projects" loading loadingLabel="Loading Client Data…" />
  }

  const navItems = [
    { label: 'Dashboard', href: '/oj-projects', icon: <LayoutDashboard className="w-4 h-4" /> },
    { label: 'Projects', href: '/oj-projects/projects', icon: <Briefcase className="w-4 h-4" /> },
    { label: 'Entries', href: '/oj-projects/entries', icon: <List className="w-4 h-4" /> },
    { label: 'Clients', href: '/oj-projects/clients', active: true, icon: <Users className="w-4 h-4" /> },
    { label: 'Work Types', href: '/oj-projects/work-types', icon: <List className="w-4 h-4" /> },
  ]

  return (
    <PageLayout
      title="Clients"
      subtitle="Billing settings & contacts"
      navItems={navItems}
      headerActions={
        <Button onClick={openCreateVendor} disabled={!canCreateVendor}>
          <Plus className="w-4 h-4 mr-2" />
          New Client
        </Button>
      }
    >
      {error && <Alert variant="error" description={error} className="mb-6" />}
      {emailStatus && !emailStatus.configured && (
        <Alert
          variant="warning"
          className="mb-6"
          title="Email service not configured"
          description="Automated billing can create invoices, but emails will fail to send until Microsoft Graph is configured."
        />
      )}
      {selectedVendor && !invoiceRecipientConfigured && (
        <Alert
          variant="warning"
          className="mb-6"
          title="No invoice recipient email configured"
          description="Add a vendor email or a contact email (and optionally mark a primary contact) to enable automated billing emails."
        />
      )}
      {selectedVendor && capMisconfigured && (
        <Alert
          variant="warning"
          className="mb-6"
          title="Monthly cap is smaller than recurring charges"
          description={`Active recurring charges total £${recurringChargesIncVat.toFixed(2)} inc VAT, which exceeds the monthly cap of £${Number.parseFloat(settings.monthly_cap_inc_vat).toFixed(2)}. Billing will fail until the cap is increased or charges are reduced.`}
        />
      )}

      {/* Client Selection Header */}
      <Card className="mb-6" variant="elevated">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div className="flex-1">
            <FormGroup label="Select Client to Manage" className="mb-0">
              <Select
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                className="text-lg font-medium"
              >
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </FormGroup>
          </div>
          <div className="text-sm text-gray-500 pb-2 md:text-right">
            <p>Manage billing rates, recurring charges, and invoice contacts.</p>
          </div>
        </div>
      </Card>

	      {!selectedVendor ? (
	        <div className="text-center py-12 text-gray-500">
	          Select a client above or create a new one to get started.
	        </div>
	      ) : (
	        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

	          {/* Billing Settings */}
	          <Card
	            header={
	              <div className="flex items-center gap-2">
	                <Settings className="w-5 h-5 text-gray-400" />
	                <CardTitle>Billing Settings</CardTitle>
	              </div>
	            }
	          >
	            <form onSubmit={saveSettings} className="space-y-4">
	              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
	                <FormGroup label="Client Code">
	                  <Input
	                    value={settings.client_code}
                    onChange={(e) => setSettings({ ...settings, client_code: e.target.value })}
                    placeholder="e.g. OJ"
                    disabled={!canEditSettings}
                    leftElement={<span className="text-gray-400 pl-3">#</span>}
                  />
                </FormGroup>

                <FormGroup label="Billing Mode" required>
                  <Select
                    value={settings.billing_mode}
                    onChange={(e) => setSettings({ ...settings, billing_mode: e.target.value as any })}
                    disabled={!canEditSettings}
                    required
                  >
                    <option value="full">Pay in full</option>
                    <option value="cap">Monthly cap</option>
                  </Select>
                </FormGroup>

                <FormGroup label="Hourly Rate (ex VAT)" required>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={settings.hourly_rate_ex_vat}
                    onChange={(e) => setSettings({ ...settings, hourly_rate_ex_vat: e.target.value })}
                    disabled={!canEditSettings}
                    required
                    leftElement={<span className="text-gray-400 pl-3">£</span>}
                  />
                </FormGroup>

                <FormGroup label="VAT Rate (%)" required>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={settings.vat_rate}
                    onChange={(e) => setSettings({ ...settings, vat_rate: e.target.value })}
                    disabled={!canEditSettings}
                    required
                    rightElement={<span className="text-gray-400 pr-3">%</span>}
                  />
                </FormGroup>

                {settings.billing_mode === 'cap' && (
                  <FormGroup label="Monthly Cap (inc VAT)" required>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={settings.monthly_cap_inc_vat}
                      onChange={(e) => setSettings({ ...settings, monthly_cap_inc_vat: e.target.value })}
                      disabled={!canEditSettings}
                      leftElement={<span className="text-gray-400 pl-3">£</span>}
                    />
                  </FormGroup>
                )}

                <FormGroup label="Mileage Rate (£/mile)" required>
                  <Input
                    type="number"
                    min="0"
                    step="0.001"
                    value={settings.mileage_rate}
                    onChange={(e) => setSettings({ ...settings, mileage_rate: e.target.value })}
                    disabled={!canEditSettings}
                    required
                    leftElement={<span className="text-gray-400 pl-3">£</span>}
                  />
                </FormGroup>

                <div className="sm:col-span-2">
                  <FormGroup label="Retainer Hours (Monthly Allowance)">
                    <Input
                      type="number"
                      min="0"
                      step="0.25"
                      value={settings.retainer_included_hours_per_month}
                      onChange={(e) => setSettings({ ...settings, retainer_included_hours_per_month: e.target.value })}
                      disabled={!canEditSettings}
                      placeholder="Optional (auto-creates a monthly retainer project on the 1st)"
                      rightElement={<span className="text-gray-400 pr-3">hrs</span>}
                    />
                  </FormGroup>
                </div>
              </div>

              <div className="flex justify-end pt-2 border-t border-gray-100">
                <Button type="submit" loading={savingSettings} disabled={!canEditSettings || savingSettings}>
                  <Save className="w-4 h-4 mr-2" />
                  Save Settings
                </Button>
              </div>
            </form>
          </Card>

          {/* Contacts Column */}
	          <div className="space-y-6">

	            {/* Recurring Charges */}
	            <Card
	              header={
	                <div className="flex items-center gap-2">
	                  <CreditCard className="w-5 h-5 text-gray-400" />
	                  <CardTitle>Recurring Charges</CardTitle>
	                </div>
	              }
	            >
	              {charges.length === 0 ? (
	                <div className="text-sm text-gray-500 py-2">No recurring charges.</div>
	              ) : (
	                <div className="space-y-2 mb-4">
	                  {charges.map((c) => (
                    <div key={c.id} className="group border rounded-md p-3 flex items-start justify-between gap-3 hover:bg-gray-50 transition-colors">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{c.description}</div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          £{Number(c.amount_ex_vat).toFixed(2)} + VAT • {Number(c.vat_rate)}% VAT
                        </div>
                        {!c.is_active && <span className="text-xs text-red-500 font-medium">Inactive</span>}
                      </div>
	                      <div className="shrink-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
	                        <IconButton
	                          variant="ghost"
	                          size="sm"
	                          aria-label="Edit charge"
	                          title="Edit charge"
	                          disabled={!canEditSettings}
	                          onClick={() =>
	                            setChargeForm({
	                              id: c.id,
	                              description: c.description || '',
                              amount_ex_vat: c.amount_ex_vat != null ? String(c.amount_ex_vat) : '',
                              vat_rate: c.vat_rate != null ? String(c.vat_rate) : '20',
                              is_active: !!c.is_active,
	                              sort_order: c.sort_order != null ? String(c.sort_order) : '0',
	                            })
	                          }
	                        >
	                          <Settings className="w-3.5 h-3.5" />
	                        </IconButton>
	                        <IconButton
	                          variant="ghost"
	                          size="sm"
	                          aria-label="Disable charge"
	                          title="Disable charge"
	                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
	                          disabled={!canEditSettings}
	                          onClick={() => disableCharge(c.id)}
	                        >
	                          <Trash2 className="w-3.5 h-3.5" />
	                        </IconButton>
	                      </div>
	                    </div>
	                  ))}
	                </div>
	              )}

              <div className="border-t border-gray-100 pt-4">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{chargeForm.id ? 'Edit Charge' : 'Add New Charge'}</h4>
                <form onSubmit={saveCharge} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormGroup label="Description" className="sm:col-span-2 mb-0">
                      <Input
                        value={chargeForm.description}
                        onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })}
                        disabled={!canEditSettings}
                        required
                        placeholder="e.g. Hosting"
                      />
                    </FormGroup>
                    <FormGroup label="Amount (ex VAT)" className="mb-0">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={chargeForm.amount_ex_vat}
                        onChange={(e) => setChargeForm({ ...chargeForm, amount_ex_vat: e.target.value })}
                        disabled={!canEditSettings}
                        required
                        leftElement={<span className="text-gray-400 pl-3">£</span>}
                      />
                    </FormGroup>
                    <div className="flex gap-2 items-end">
                      {chargeForm.id && (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setChargeForm({ description: '', amount_ex_vat: '', vat_rate: '20', is_active: true, sort_order: '0' })}
                          disabled={!canEditSettings}
                          className="flex-1"
                        >
                          Cancel
                        </Button>
                      )}
                      <Button type="submit" loading={chargeSaving} disabled={!canEditSettings || chargeSaving} className="flex-1">
                        {chargeForm.id ? 'Save' : 'Add'}
                      </Button>
                    </div>
                  </div>
                </form>
              </div>
	            </Card>

	            {/* Contacts */}
	            <Card
	              header={
	                <div className="flex items-center gap-2">
	                  <Users className="w-5 h-5 text-gray-400" />
	                  <CardTitle>Invoice Contacts</CardTitle>
	                </div>
	              }
	            >
	              {!canEditContacts && (
	                <Alert variant="info" className="mb-4" description="Read-only access." />
	              )}

              {contacts.length === 0 ? (
                <div className="text-sm text-gray-500 py-2">No contacts found.</div>
              ) : (
                <div className="space-y-2 mb-4">
                  {contacts.map((c) => (
                    <div key={c.id} className="group border rounded-md p-3 flex items-start justify-between gap-3 bg-white hover:bg-gray-50 transition-colors">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate text-gray-900">{c.name || 'Unnamed Contact'}</span>
                          {c.is_primary && <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-bold uppercase tracking-wide">Primary</span>}
                          {!!c.receive_invoice_copy && <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] uppercase tracking-wide">CC</span>}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                          {c.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {c.email}</span>}
                          {c.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {c.phone}</span>}
                        </div>
	                      </div>
	                      <div className="shrink-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
	                        <IconButton
	                          variant="ghost"
	                          size="sm"
	                          aria-label="Edit contact"
	                          title="Edit contact"
	                          disabled={!canEditContacts}
	                          onClick={() =>
	                            setContactForm({
	                              id: c.id,
	                              name: c.name || '',
                              email: c.email || '',
                              phone: c.phone || '',
                              role: c.role || '',
                              is_primary: c.is_primary,
	                              receive_invoice_copy: !!c.receive_invoice_copy,
	                            })
	                          }
	                        >
	                          <Settings className="w-3.5 h-3.5" />
	                        </IconButton>
	                        <IconButton
	                          variant="ghost"
	                          size="sm"
	                          aria-label="Delete contact"
	                          title="Delete contact"
	                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
	                          disabled={!canEditContacts}
	                          onClick={() => removeContact(c.id)}
	                        >
	                          <Trash2 className="w-3.5 h-3.5" />
	                        </IconButton>
	                      </div>
	                    </div>
	                  ))}
	                </div>
	              )}

              <div className="border-t border-gray-100 pt-4">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{contactForm.id ? 'Edit Contact' : 'Add New Contact'}</h4>
                <form onSubmit={saveContact} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormGroup label="Name" className="mb-0">
                      <Input value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} disabled={!canEditContacts} placeholder="Contact Name" />
                    </FormGroup>
                    <FormGroup label="Email" className="mb-0" required>
                      <Input type="email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} disabled={!canEditContacts} required placeholder="email@address.com" />
                    </FormGroup>

                    <div className="sm:col-span-2 flex gap-4 text-sm pt-1">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={contactForm.is_primary} onChange={(e) => setContactForm({ ...contactForm, is_primary: e.target.checked })} disabled={!canEditContacts} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                        <span>Primary Invoice Recipient</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={contactForm.receive_invoice_copy} onChange={(e) => setContactForm({ ...contactForm, receive_invoice_copy: e.target.checked })} disabled={!canEditContacts} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                        <span>CC on Invoices</span>
                      </label>
                    </div>

                    <div className="sm:col-span-2 flex gap-2 justify-end pt-1">
                      {contactForm.id && (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setContactForm({ name: '', email: '', phone: '', role: '', is_primary: false, receive_invoice_copy: false })}
                          disabled={!canEditContacts}
                        >
                          Cancel
                        </Button>
                      )}
                      <Button type="submit" loading={contactSaving} disabled={!canEditContacts || contactSaving}>
                        {contactForm.id ? 'Save Contact' : 'Add Contact'}
                      </Button>
                    </div>
                  </div>
                </form>
              </div>
            </Card>
          </div>
        </div>
      )}

      <Modal open={vendorModalOpen} onClose={() => setVendorModalOpen(false)} title="New Client">
        <form onSubmit={createNewVendor} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <FormGroup label="Company Name" required>
                <Input value={vendorForm.name} onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })} required />
              </FormGroup>
            </div>
            <FormGroup label="Invoice Email(s)">
              <Input
                type="text"
                value={vendorForm.email}
                onChange={(e) => setVendorForm({ ...vendorForm, email: e.target.value })}
                placeholder="Optional (comma/semicolon separated)"
              />
            </FormGroup>
            <FormGroup label="Phone">
              <Input value={vendorForm.phone} onChange={(e) => setVendorForm({ ...vendorForm, phone: e.target.value })} />
            </FormGroup>
            <FormGroup label="Payment Terms (days)">
              <Input
                type="number"
                min="0"
                step="1"
                value={vendorForm.payment_terms}
                onChange={(e) => setVendorForm({ ...vendorForm, payment_terms: e.target.value })}
              />
            </FormGroup>
            <div className="md:col-span-2">
              <FormGroup label="Address">
                <Textarea value={vendorForm.address} onChange={(e) => setVendorForm({ ...vendorForm, address: e.target.value })} rows={2} />
              </FormGroup>
            </div>
            <div className="md:col-span-2">
              <FormGroup label="Notes">
                <Textarea value={vendorForm.notes} onChange={(e) => setVendorForm({ ...vendorForm, notes: e.target.value })} rows={2} />
              </FormGroup>
            </div>
          </div>

          <ModalActions>
            <Button type="button" variant="secondary" onClick={() => setVendorModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={vendorSaving} disabled={!canCreateVendor || vendorSaving}>
              Create Client
            </Button>
          </ModalActions>
        </form>
      </Modal>
    </PageLayout>
  )
}
