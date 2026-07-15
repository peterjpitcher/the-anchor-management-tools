'use client'

import { useMemo, useState } from 'react'
import {
  Card,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
  Button,
  SearchInput,
  Drawer,
  Modal,
  Field,
  Input,
  Textarea,
  Select,
  Checkbox,
  Empty,
  ConfirmDialog,
  RowActions,
  toast,
} from '@/ds'
import { Icon } from '@/ds/icons'
import { usePermissions } from '@/contexts/PermissionContext'
import { getClientBalance } from '@/app/actions/oj-projects/client-balance'
import { getClientStatement, sendStatementEmail } from '@/app/actions/oj-projects/client-statement'
import {
  createRecurringCharge,
  disableRecurringCharge,
  getRecurringCharges,
  updateRecurringCharge,
} from '@/app/actions/oj-projects/recurring-charges'
import type { ClientBalance } from '@/app/actions/oj-projects/client-balance'
import type { ClientStatementData } from '@/app/actions/oj-projects/client-statement'
import {
  createOJClient,
  deleteOJClient,
  getOJClients,
  updateOJClient,
  type OJClientSummary,
} from '@/app/actions/oj-projects/clients'
import {
  getVendorBillingSettings,
  upsertVendorBillingSettings,
  type OJVendorBillingSettings,
} from '@/app/actions/oj-projects/vendor-settings'
import { formatDateDdMmmmYyyy } from '@/lib/dateUtils'

function formatCurrency(value: number): string {
  return `£${value.toFixed(2)}`
}

type RecurringChargeFrequency = 'monthly' | 'quarterly' | 'annually'

type RecurringCharge = {
  id: string
  vendor_id: string
  description: string
  amount_ex_vat: number
  vat_rate: number
  frequency: RecurringChargeFrequency
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

type RecurringChargeForm = {
  id?: string
  description: string
  amount_ex_vat: string
  vat_rate: string
  frequency: RecurringChargeFrequency
  is_active: boolean
  sort_order: string
}

type ClientForm = {
  id?: string
  name: string
  contact_name: string
  email: string
  phone: string
  address: string
  vat_number: string
  payment_terms: string
  notes: string
}

type BillingSettingsForm = {
  client_code: string
  billing_mode: 'full' | 'cap'
  monthly_cap_inc_vat: string
  hourly_rate_ex_vat: string
  vat_rate: string
  mileage_rate: string
  retainer_included_hours_per_month: string
  statement_mode: boolean
}

const emptyRecurringChargeForm: RecurringChargeForm = {
  description: '',
  amount_ex_vat: '',
  vat_rate: '20',
  frequency: 'monthly',
  is_active: true,
  sort_order: '0',
}

const emptyClientForm: ClientForm = {
  name: '',
  contact_name: '',
  email: '',
  phone: '',
  address: '',
  vat_number: '',
  payment_terms: '30',
  notes: '',
}

const defaultBillingSettingsForm: BillingSettingsForm = {
  client_code: '',
  billing_mode: 'full',
  monthly_cap_inc_vat: '',
  hourly_rate_ex_vat: '75',
  vat_rate: '20',
  mileage_rate: '0.55',
  retainer_included_hours_per_month: '',
  statement_mode: false,
}

const recurringFrequencyOptions = [
  { label: 'Monthly', value: 'monthly' },
  { label: 'Quarterly', value: 'quarterly' },
  { label: 'Annually', value: 'annually' },
]

function formatFrequency(value: string): string {
  switch (value) {
    case 'quarterly':
      return 'Quarterly'
    case 'annually':
      return 'Annually'
    default:
      return 'Monthly'
  }
}

function calculateIncVat(amountExVat: number, vatRate: number): number {
  return amountExVat * (1 + vatRate / 100)
}

function clientToForm(client: OJClientSummary): ClientForm {
  return {
    id: client.id,
    name: client.name,
    contact_name: client.contact_name ?? '',
    email: client.email ?? '',
    phone: client.phone ?? '',
    address: client.address ?? '',
    vat_number: client.vat_number ?? '',
    payment_terms: String(client.payment_terms ?? 30),
    notes: client.notes ?? '',
  }
}

function settingsToForm(settings: OJVendorBillingSettings | null): BillingSettingsForm {
  if (!settings) return defaultBillingSettingsForm
  return {
    client_code: settings.client_code ?? '',
    billing_mode: settings.billing_mode === 'cap' ? 'cap' : 'full',
    monthly_cap_inc_vat: settings.monthly_cap_inc_vat != null ? String(settings.monthly_cap_inc_vat) : '',
    hourly_rate_ex_vat: String(settings.hourly_rate_ex_vat ?? 75),
    vat_rate: String(settings.vat_rate ?? 20),
    mileage_rate: String(settings.mileage_rate ?? 0.55),
    retainer_included_hours_per_month: settings.retainer_included_hours_per_month != null
      ? String(settings.retainer_included_hours_per_month)
      : '',
    statement_mode: Boolean(settings.statement_mode),
  }
}

interface ClientsClientProps {
  initialClients: OJClientSummary[]
}

export function ClientsClient({ initialClients }: ClientsClientProps): React.ReactElement {
  const { hasPermission } = usePermissions()
  const canCreateClients = hasPermission('oj_projects', 'create')
  const canEditClients = hasPermission('oj_projects', 'edit')
  const canDeleteClients = hasPermission('oj_projects', 'delete')
  const canEditRecurringCharges = canEditClients

  const [clients, setClients] = useState(initialClients)
  const [search, setSearch] = useState('')
  const [drawerVendor, setDrawerVendor] = useState<OJClientSummary | null>(null)
  const [balance, setBalance] = useState<ClientBalance | null>(null)
  const [loadingBalance, setLoadingBalance] = useState(false)
  const [loadingBillingSettings, setLoadingBillingSettings] = useState(false)
  const [billingForm, setBillingForm] = useState<BillingSettingsForm>(defaultBillingSettingsForm)
  const [billingSaving, setBillingSaving] = useState(false)
  const [recurringCharges, setRecurringCharges] = useState<RecurringCharge[]>([])
  const [loadingRecurringCharges, setLoadingRecurringCharges] = useState(false)
  const [chargeModalOpen, setChargeModalOpen] = useState(false)
  const [chargeForm, setChargeForm] = useState<RecurringChargeForm>(emptyRecurringChargeForm)
  const [chargeSaving, setChargeSaving] = useState(false)
  const [disableChargeId, setDisableChargeId] = useState<string | null>(null)
  const [clientModalOpen, setClientModalOpen] = useState(false)
  const [clientForm, setClientForm] = useState<ClientForm>(emptyClientForm)
  const [clientSaving, setClientSaving] = useState(false)
  const [deleteClientId, setDeleteClientId] = useState<string | null>(null)

  // Statement state
  const [statementFrom, setStatementFrom] = useState('')
  const [statementTo, setStatementTo] = useState('')
  const [statement, setStatement] = useState<ClientStatementData | null>(null)
  const [loadingStatement, setLoadingStatement] = useState(false)
  const [sendingEmail, setSendingEmail] = useState(false)

  const filtered = useMemo(() => {
    if (!search.trim()) return clients
    const q = search.toLowerCase()
    return clients.filter((c) => c.name.toLowerCase().includes(q))
  }, [clients, search])

  async function openDrawer(client: OJClientSummary): Promise<void> {
    setDrawerVendor(client)
    setBalance(null)
    setRecurringCharges([])
    setBillingForm(defaultBillingSettingsForm)
    setStatement(null)
    setLoadingBalance(true)
    setLoadingRecurringCharges(true)
    setLoadingBillingSettings(true)

    // Default statement date range to last 3 months
    const now = new Date()
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1)
    setStatementFrom(threeMonthsAgo.toISOString().split('T')[0])
    setStatementTo(now.toISOString().split('T')[0])

    try {
      const [balanceRes, chargesRes, settingsRes] = await Promise.all([
        getClientBalance(client.id),
        getRecurringCharges(client.id),
        getVendorBillingSettings(client.id),
      ])

      if (balanceRes.error) {
        toast.error(balanceRes.error)
      } else {
        setBalance(balanceRes.balance ?? null)
      }

      if (chargesRes.error) {
        toast.error(chargesRes.error)
      } else {
        setRecurringCharges((chargesRes.charges ?? []) as RecurringCharge[])
      }

      if (settingsRes.error) {
        toast.error(settingsRes.error)
      } else {
        setBillingForm(settingsToForm(settingsRes.settings ?? null))
      }
    } catch {
      toast.error('Failed to load client details')
    } finally {
      setLoadingBalance(false)
      setLoadingRecurringCharges(false)
      setLoadingBillingSettings(false)
    }
  }

  async function reloadClients(): Promise<void> {
    const res = await getOJClients()
    if (res.error) {
      toast.error(res.error)
    } else {
      setClients(res.clients ?? [])
    }
  }

  function openCreateClient(): void {
    setClientForm(emptyClientForm)
    setClientModalOpen(true)
  }

  function openEditClient(client: OJClientSummary): void {
    setClientForm(clientToForm(client))
    setClientModalOpen(true)
  }

  async function handleClientSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setClientSaving(true)
    try {
      const fd = new FormData()
      if (clientForm.id) fd.append('id', clientForm.id)
      fd.append('name', clientForm.name)
      fd.append('contact_name', clientForm.contact_name)
      fd.append('email', clientForm.email)
      fd.append('phone', clientForm.phone)
      fd.append('address', clientForm.address)
      fd.append('vat_number', clientForm.vat_number)
      fd.append('payment_terms', clientForm.payment_terms)
      fd.append('notes', clientForm.notes)

      const res = clientForm.id ? await updateOJClient(fd) : await createOJClient(fd)
      if (res.error) throw new Error(res.error)

      toast.success(clientForm.id ? 'Client updated' : 'Client created')
      setClientModalOpen(false)
      setClientForm(emptyClientForm)
      await reloadClients()
      if (drawerVendor?.id === clientForm.id && res.client) {
        setDrawerVendor((current) => current ? { ...current, ...res.client } : current)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save client')
    } finally {
      setClientSaving(false)
    }
  }

  async function handleDeleteClient(): Promise<void> {
    if (!deleteClientId) return
    try {
      const fd = new FormData()
      fd.append('id', deleteClientId)
      const res = await deleteOJClient(fd)
      if (res.error) throw new Error(res.error)

      toast.success(res.action === 'deactivate' ? 'Client deactivated' : 'Client deleted')
      if (drawerVendor?.id === deleteClientId) setDrawerVendor(null)
      setDeleteClientId(null)
      await reloadClients()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete client')
    }
  }

  async function handleBillingSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!drawerVendor) return

    setBillingSaving(true)
    try {
      const fd = new FormData()
      fd.append('vendor_id', drawerVendor.id)
      fd.append('client_code', billingForm.client_code)
      fd.append('billing_mode', billingForm.billing_mode)
      fd.append('monthly_cap_inc_vat', billingForm.monthly_cap_inc_vat)
      fd.append('hourly_rate_ex_vat', billingForm.hourly_rate_ex_vat)
      fd.append('vat_rate', billingForm.vat_rate)
      fd.append('mileage_rate', billingForm.mileage_rate)
      fd.append('retainer_included_hours_per_month', billingForm.retainer_included_hours_per_month)
      fd.append('statement_mode', String(billingForm.statement_mode))

      const res = await upsertVendorBillingSettings(fd)
      if (res.error) throw new Error(res.error)

      toast.success('Billing settings saved')
      setBillingForm(settingsToForm(res.settings ?? null))
      await reloadClients()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save billing settings')
    } finally {
      setBillingSaving(false)
    }
  }

  async function reloadRecurringCharges(vendorId = drawerVendor?.id): Promise<void> {
    if (!vendorId) return

    setLoadingRecurringCharges(true)
    try {
      const res = await getRecurringCharges(vendorId)
      if (res.error) {
        toast.error(res.error)
      } else {
        setRecurringCharges((res.charges ?? []) as RecurringCharge[])
      }
    } catch {
      toast.error('Failed to load recurring charges')
    } finally {
      setLoadingRecurringCharges(false)
    }
  }

  function openCreateCharge(): void {
    setChargeForm(emptyRecurringChargeForm)
    setChargeModalOpen(true)
  }

  function openEditCharge(charge: RecurringCharge): void {
    setChargeForm({
      id: charge.id,
      description: charge.description || '',
      amount_ex_vat: String(charge.amount_ex_vat ?? ''),
      vat_rate: String(charge.vat_rate ?? 20),
      frequency: charge.frequency || 'monthly',
      is_active: charge.is_active,
      sort_order: String(charge.sort_order ?? 0),
    })
    setChargeModalOpen(true)
  }

  async function handleChargeSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!drawerVendor) return

    setChargeSaving(true)
    try {
      const fd = new FormData()
      fd.append('vendor_id', drawerVendor.id)
      fd.append('description', chargeForm.description)
      fd.append('amount_ex_vat', chargeForm.amount_ex_vat)
      fd.append('vat_rate', chargeForm.vat_rate)
      fd.append('frequency', chargeForm.frequency)
      fd.append('is_active', String(chargeForm.is_active))
      fd.append('sort_order', chargeForm.sort_order)
      if (chargeForm.id) fd.append('id', chargeForm.id)

      const res = chargeForm.id ? await updateRecurringCharge(fd) : await createRecurringCharge(fd)
      if (res.error) throw new Error(res.error)

      toast.success(chargeForm.id ? 'Recurring charge updated' : 'Recurring charge added')
      setChargeModalOpen(false)
      setChargeForm(emptyRecurringChargeForm)
      await reloadRecurringCharges(drawerVendor.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save recurring charge')
    } finally {
      setChargeSaving(false)
    }
  }

  async function handleDisableCharge(): Promise<void> {
    if (!disableChargeId || !drawerVendor) return

    try {
      const fd = new FormData()
      fd.append('id', disableChargeId)
      const res = await disableRecurringCharge(fd)
      if (res.error) throw new Error(res.error)

      toast.success('Recurring charge disabled')
      setDisableChargeId(null)
      await reloadRecurringCharges(drawerVendor.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disable recurring charge')
    }
  }

  async function loadStatement(): Promise<void> {
    if (!drawerVendor || !statementFrom || !statementTo) return
    setLoadingStatement(true)
    setStatement(null)
    try {
      const res = await getClientStatement(drawerVendor.id, statementFrom, statementTo)
      if (res.error) {
        toast.error(res.error)
      } else {
        setStatement(res.statement ?? null)
      }
    } catch {
      toast.error('Failed to load statement')
    } finally {
      setLoadingStatement(false)
    }
  }

  async function handleSendStatement(): Promise<void> {
    if (!drawerVendor || !statementFrom || !statementTo) return
    setSendingEmail(true)
    try {
      const res = await sendStatementEmail(drawerVendor.id, statementFrom, statementTo)
      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success('Statement email sent')
      }
    } catch {
      toast.error('Failed to send statement')
    } finally {
      setSendingEmail(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search clients..."
          className="flex-1 sm:max-w-xs"
        />
        {canCreateClients && (
          <Button
            variant="primary"
            icon={<Icon name="plus" size={16} />}
            onClick={openCreateClient}
          >
            Add Client
          </Button>
        )}
      </div>

      {/* Clients Table */}
      <Card>
        {filtered.length === 0 ? (
          <Empty title="No clients" description="No clients found." />
        ) : (
          <>
            <div className="divide-y divide-border md:hidden">
              {filtered.map((client) => (
                <div key={client.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="font-medium text-text">{client.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge tone="info">
                        {client.projectCount} project{client.projectCount !== 1 ? 's' : ''}
                      </Badge>
                      {client.retainerHours ? (
                        <Badge tone="success">{client.retainerHours}h / month</Badge>
                      ) : (
                        <span className="text-xs text-text-muted">No retainer</span>
                      )}
                    </div>
                  </div>
                  <RowActions
                    actions={[
                      {
                        key: 'view',
                        label: 'View',
                        icon: <Icon name="eye" size={16} />,
                        onSelect: () => openDrawer(client),
                      },
                      canEditClients && {
                        key: 'edit',
                        label: 'Edit',
                        icon: <Icon name="edit" size={16} />,
                        onSelect: () => openEditClient(client),
                      },
                      canDeleteClients && {
                        key: 'delete',
                        label: 'Delete',
                        icon: <Icon name="trash" size={16} />,
                        tone: 'danger',
                        onSelect: () => setDeleteClientId(client.id),
                      },
                    ]}
                  />
                </div>
              ))}
            </div>
            <Table className="hidden md:block">
            <TableHeader>
              <TableRow>
                <TableHead>Client Name</TableHead>
                <TableHead>Projects</TableHead>
                <TableHead>Retainer</TableHead>
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((client) => (
                <TableRow key={client.id}>
                  <TableCell className="font-medium">{client.name}</TableCell>
                  <TableCell>
                    <Badge tone="info">{client.projectCount} project{client.projectCount !== 1 ? 's' : ''}</Badge>
                  </TableCell>
                  <TableCell>
                    {client.retainerHours ? (
                      <Badge tone="success">{client.retainerHours}h / month</Badge>
                    ) : (
                      <span className="text-sm text-text-muted">None</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <RowActions
                      actions={[
                        {
                          key: 'view',
                          label: 'View',
                          icon: <Icon name="eye" size={16} />,
                          onSelect: () => openDrawer(client),
                        },
                        canEditClients && {
                          key: 'edit',
                          label: 'Edit',
                          icon: <Icon name="edit" size={16} />,
                          onSelect: () => openEditClient(client),
                        },
                        canDeleteClients && {
                          key: 'delete',
                          label: 'Delete',
                          icon: <Icon name="trash" size={16} />,
                          tone: 'danger',
                          onSelect: () => setDeleteClientId(client.id),
                        },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            </Table>
          </>
        )}
      </Card>

      {/* Balance / Statement Drawer */}
      <Drawer
        open={!!drawerVendor}
        onClose={() => setDrawerVendor(null)}
        title={drawerVendor?.name ?? 'Client'}
        width="480px"
      >
        {loadingBalance ? (
          <p className="text-sm text-text-muted py-4">Loading balance...</p>
        ) : balance ? (
          <div className="flex flex-col gap-6">
            {/* Balance summary */}
            <div>
              <h3 className="text-sm font-semibold text-text mb-3">Balance Summary</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="p-3 rounded-lg bg-surface-2">
                  <p className="text-xs text-text-muted">Unpaid Invoices</p>
                  <p className="text-lg font-semibold">{formatCurrency(balance.unpaidInvoiceBalance)}</p>
                </div>
                <div className="p-3 rounded-lg bg-surface-2">
                  <p className="text-xs text-text-muted">Unbilled Work</p>
                  <p className="text-lg font-semibold">{formatCurrency(balance.unbilledTotal)}</p>
                </div>
                <div className="p-3 rounded-lg bg-surface-2 col-span-2">
                  <p className="text-xs text-text-muted">Total Outstanding</p>
                  <p className={`text-xl font-bold ${balance.totalOutstanding > 0 ? 'text-danger' : 'text-success'}`}>
                    {formatCurrency(balance.totalOutstanding)}
                  </p>
                </div>
              </div>

              {/* Unbilled breakdown */}
              {balance.unbilledTotal > 0 && (
                <div className="mt-3 space-y-1 text-sm">
                  {balance.unbilledTimeTotal > 0 && (
                    <div className="flex justify-between text-text-muted">
                      <span>Time</span>
                      <span>{formatCurrency(balance.unbilledTimeTotal)}</span>
                    </div>
                  )}
                  {balance.unbilledMileageTotal > 0 && (
                    <div className="flex justify-between text-text-muted">
                      <span>Mileage</span>
                      <span>{formatCurrency(balance.unbilledMileageTotal)}</span>
                    </div>
                  )}
                  {balance.unbilledOneOffTotal > 0 && (
                    <div className="flex justify-between text-text-muted">
                      <span>One-off charges</span>
                      <span>{formatCurrency(balance.unbilledOneOffTotal)}</span>
                    </div>
                  )}
                  {balance.unbilledRecurringTotal > 0 && (
                    <div className="flex justify-between text-text-muted">
                      <span>Recurring</span>
                      <span>{formatCurrency(balance.unbilledRecurringTotal)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Invoices */}
            {balance.invoices.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-text mb-2">Recent Invoices</h3>
                <div className="flex flex-col gap-2">
                  {balance.invoices.slice(0, 5).map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between text-sm p-2 rounded-lg bg-surface-2">
                      <div>
                        <p className="font-medium">{inv.invoice_number}</p>
                        <p className="text-xs text-text-muted">{formatDateDdMmmmYyyy(inv.invoice_date)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{formatCurrency(inv.total_amount)}</p>
                        <Badge tone={inv.status === 'paid' ? 'success' : inv.outstanding > 0 ? 'warning' : 'info'}>
                          {inv.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Billing settings */}
            <div className="border-t border-border pt-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-text">Billing Settings</h3>
                {loadingBillingSettings && (
                  <span className="text-xs text-text-muted">Loading...</span>
                )}
              </div>

              <form onSubmit={handleBillingSubmit} className="flex flex-col gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Client Code">
                    <Input
                      value={billingForm.client_code}
                      onChange={(e) => setBillingForm((current) => ({ ...current, client_code: e.target.value }))}
                      maxLength={10}
                      disabled={!canEditClients || loadingBillingSettings}
                    />
                  </Field>
                  <Field label="Billing Mode" required>
                    <Select
                      value={billingForm.billing_mode}
                      onChange={(e) => setBillingForm((current) => ({ ...current, billing_mode: e.target.value as 'full' | 'cap' }))}
                      options={[
                        { label: 'Full', value: 'full' },
                        { label: 'Monthly cap', value: 'cap' },
                      ]}
                      disabled={!canEditClients || loadingBillingSettings}
                    />
                  </Field>
                </div>

                {billingForm.billing_mode === 'cap' && (
                  <Field label="Monthly Cap inc VAT" required>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={billingForm.monthly_cap_inc_vat}
                      onChange={(e) => setBillingForm((current) => ({ ...current, monthly_cap_inc_vat: e.target.value }))}
                      disabled={!canEditClients || loadingBillingSettings}
                      required
                    />
                  </Field>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Hourly Rate ex VAT" required>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={billingForm.hourly_rate_ex_vat}
                      onChange={(e) => setBillingForm((current) => ({ ...current, hourly_rate_ex_vat: e.target.value }))}
                      disabled={!canEditClients || loadingBillingSettings}
                      required
                    />
                  </Field>
                  <Field label="VAT Rate" required>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={billingForm.vat_rate}
                      onChange={(e) => setBillingForm((current) => ({ ...current, vat_rate: e.target.value }))}
                      disabled={!canEditClients || loadingBillingSettings}
                      required
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Mileage Rate">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={billingForm.mileage_rate}
                      onChange={(e) => setBillingForm((current) => ({ ...current, mileage_rate: e.target.value }))}
                      disabled={!canEditClients || loadingBillingSettings}
                    />
                  </Field>
                  <Field label="Retainer Hours">
                    <Input
                      type="number"
                      min="0"
                      step="0.25"
                      value={billingForm.retainer_included_hours_per_month}
                      onChange={(e) => setBillingForm((current) => ({ ...current, retainer_included_hours_per_month: e.target.value }))}
                      disabled={!canEditClients || loadingBillingSettings}
                    />
                  </Field>
                </div>

                <Checkbox
                  label="Use statement billing"
                  checked={billingForm.statement_mode}
                  onChange={(checked) => setBillingForm((current) => ({ ...current, statement_mode: Boolean(checked) }))}
                  disabled={!canEditClients || loadingBillingSettings}
                />

                {canEditClients && (
                  <div className="flex justify-end">
                    <Button type="submit" size="sm" loading={billingSaving}>
                      Save Billing Settings
                    </Button>
                  </div>
                )}
              </form>
            </div>

            {/* Recurring charges */}
            <div className="border-t border-border pt-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-text">Recurring Charges</h3>
                {canEditRecurringCharges && (
                  <Button
                    variant="secondary"
                    size="xs"
                    icon={<Icon name="plus" size={14} />}
                    onClick={openCreateCharge}
                  >
                    Add
                  </Button>
                )}
              </div>

              {loadingRecurringCharges ? (
                <p className="py-2 text-sm text-text-muted">Loading charges...</p>
              ) : recurringCharges.length === 0 ? (
                <p className="py-2 text-sm text-text-muted">No recurring charges set up.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {recurringCharges.map((charge) => {
                    const incVat = calculateIncVat(Number(charge.amount_ex_vat || 0), Number(charge.vat_rate || 0))
                    return (
                      <div key={charge.id} className="rounded-lg border border-border bg-surface p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-text">{charge.description}</p>
                            <p className="mt-1 text-xs text-text-muted">
                              {formatFrequency(charge.frequency)} · {formatCurrency(Number(charge.amount_ex_vat || 0))} ex VAT · {formatCurrency(incVat)} inc VAT
                            </p>
                          </div>
                          <Badge tone={charge.is_active ? 'success' : 'neutral'}>
                            {charge.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>

                        {canEditRecurringCharges && (
                          <RowActions
                            className="mt-3"
                            actions={[
                              {
                                key: 'edit',
                                label: 'Edit',
                                icon: <Icon name="edit" size={16} />,
                                onSelect: () => openEditCharge(charge),
                              },
                              charge.is_active && {
                                key: 'disable',
                                label: 'Disable',
                                icon: <Icon name="x" size={16} />,
                                tone: 'danger',
                                onSelect: () => setDisableChargeId(charge.id),
                              },
                            ]}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Statement generator */}
            <div className="border-t border-border pt-4">
              <h3 className="text-sm font-semibold text-text mb-3">Account Statement</h3>
              <div className="grid grid-cols-1 gap-3 mb-3 sm:grid-cols-2">
                <Field label="From">
                  <Input
                    type="date"
                    value={statementFrom}
                    onChange={(e) => setStatementFrom(e.target.value)}
                  />
                </Field>
                <Field label="To">
                  <Input
                    type="date"
                    value={statementTo}
                    onChange={(e) => setStatementTo(e.target.value)}
                  />
                </Field>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={loadStatement}
                  loading={loadingStatement}
                >
                  Preview
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleSendStatement}
                  loading={sendingEmail}
                >
                  Email Statement
                </Button>
              </div>

              {/* Statement preview */}
              {statement && (
                <div className="mt-4 border border-border rounded-lg p-3 text-sm">
                  <div className="flex justify-between mb-2 text-text-muted">
                    <span>Opening balance</span>
                    <span className="font-medium">{formatCurrency(statement.openingBalance)}</span>
                  </div>
                  {statement.transactions.length === 0 ? (
                    <p className="text-text-muted text-center py-2">No transactions in this period.</p>
                  ) : (
                    <div className="max-h-[200px] overflow-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border">
                            <th scope="col" className="text-left py-1">Date</th>
                            <th scope="col" className="text-left py-1">Description</th>
                            <th scope="col" className="text-right py-1">Debit</th>
                            <th scope="col" className="text-right py-1">Credit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {statement.transactions.map((txn, i) => (
                            <tr key={i} className="border-b border-border/50">
                              <td className="py-1">{txn.date}</td>
                              <td className="py-1 truncate max-w-[120px]">{txn.description}</td>
                              <td className="py-1 text-right">{txn.debit != null ? formatCurrency(txn.debit) : ''}</td>
                              <td className="py-1 text-right text-success">{txn.credit != null ? formatCurrency(txn.credit) : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="flex justify-between mt-2 pt-2 border-t border-border font-medium">
                    <span>Closing balance</span>
                    <span className={statement.closingBalance > 0 ? 'text-danger' : 'text-success'}>
                      {formatCurrency(statement.closingBalance)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-muted py-4">Select a client to view balance details.</p>
        )}
      </Drawer>

      <Modal
        open={clientModalOpen}
        onClose={() => setClientModalOpen(false)}
        title={clientForm.id ? 'Edit Client' : 'Add Client'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setClientModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="oj-client-form"
              loading={clientSaving}
            >
              {clientForm.id ? 'Save Changes' : 'Add Client'}
            </Button>
          </>
        }
      >
        <form id="oj-client-form" onSubmit={handleClientSubmit} className="flex flex-col gap-4">
          <Field label="Client Name" required>
            <Input
              value={clientForm.name}
              onChange={(e) => setClientForm((current) => ({ ...current, name: e.target.value }))}
              maxLength={200}
              required
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Contact Name">
              <Input
                value={clientForm.contact_name}
                onChange={(e) => setClientForm((current) => ({ ...current, contact_name: e.target.value }))}
                maxLength={200}
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={clientForm.email}
                onChange={(e) => setClientForm((current) => ({ ...current, email: e.target.value }))}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Phone">
              <Input
                value={clientForm.phone}
                onChange={(e) => setClientForm((current) => ({ ...current, phone: e.target.value }))}
                maxLength={50}
              />
            </Field>
            <Field label="Payment Terms">
              <Input
                type="number"
                min="0"
                max="365"
                step="1"
                value={clientForm.payment_terms}
                onChange={(e) => setClientForm((current) => ({ ...current, payment_terms: e.target.value }))}
              />
            </Field>
          </div>

          <Field label="Address">
            <Textarea
              value={clientForm.address}
              onChange={(e) => setClientForm((current) => ({ ...current, address: e.target.value }))}
              rows={3}
              maxLength={1000}
            />
          </Field>

          <Field label="VAT Number">
            <Input
              value={clientForm.vat_number}
              onChange={(e) => setClientForm((current) => ({ ...current, vat_number: e.target.value }))}
              maxLength={50}
            />
          </Field>

          <Field label="Notes">
            <Textarea
              value={clientForm.notes}
              onChange={(e) => setClientForm((current) => ({ ...current, notes: e.target.value }))}
              rows={3}
              maxLength={2000}
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={chargeModalOpen}
        onClose={() => setChargeModalOpen(false)}
        title={chargeForm.id ? 'Edit Recurring Charge' : 'Add Recurring Charge'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setChargeModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="oj-recurring-charge-form"
              loading={chargeSaving}
            >
              {chargeForm.id ? 'Save Changes' : 'Add Charge'}
            </Button>
          </>
        }
      >
        <form id="oj-recurring-charge-form" onSubmit={handleChargeSubmit} className="flex flex-col gap-4">
          <Field label="Description" required>
            <Input
              value={chargeForm.description}
              onChange={(e) => setChargeForm((current) => ({ ...current, description: e.target.value }))}
              maxLength={200}
              required
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Amount ex VAT" required>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={chargeForm.amount_ex_vat}
                onChange={(e) => setChargeForm((current) => ({ ...current, amount_ex_vat: e.target.value }))}
                required
              />
            </Field>
            <Field label="VAT Rate" required>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={chargeForm.vat_rate}
                onChange={(e) => setChargeForm((current) => ({ ...current, vat_rate: e.target.value }))}
                required
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Frequency" required>
              <Select
                value={chargeForm.frequency}
                onChange={(e) => setChargeForm((current) => ({ ...current, frequency: e.target.value as RecurringChargeFrequency }))}
                options={recurringFrequencyOptions}
              />
            </Field>
            <Field label="Sort Order">
              <Input
                type="number"
                min="0"
                max="1000"
                step="1"
                value={chargeForm.sort_order}
                onChange={(e) => setChargeForm((current) => ({ ...current, sort_order: e.target.value }))}
              />
            </Field>
          </div>

          <Checkbox
            label="Active"
            checked={chargeForm.is_active}
            onChange={(checked) => setChargeForm((current) => ({ ...current, is_active: Boolean(checked) }))}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!disableChargeId}
        onClose={() => setDisableChargeId(null)}
        onConfirm={handleDisableCharge}
        title="Disable Recurring Charge"
        message="This recurring charge will stop being included in future billing runs."
        confirmLabel="Disable"
        tone="warning"
      />

      <ConfirmDialog
        open={!!deleteClientId}
        onClose={() => setDeleteClientId(null)}
        onConfirm={handleDeleteClient}
        title="Delete Client"
        message="Clients with projects or invoices will be deactivated instead of permanently deleted."
        confirmLabel="Delete"
        tone="danger"
      />
    </div>
  )
}
