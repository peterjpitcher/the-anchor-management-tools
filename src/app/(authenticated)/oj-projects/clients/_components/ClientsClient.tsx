'use client'

import { useMemo, useState } from 'react'
import { EndRecurringChargeModal } from './EndRecurringChargeModal'
import {
  Alert,
  Card,
  DescriptionList,
  FormFooter,
  PageLayout,
  PageLoading,
  Section,
  Spinner,
  Stat,
  StatGrid,
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
import { getWorkRecord, type WorkRecordData } from '@/app/actions/oj-projects/work-record'
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
import { cn } from '@/lib/utils'
import { formatDateDdMmmmYyyy, getTodayIsoDate } from '@/lib/dateUtils'
import { addMonthsToIsoDate } from '@/lib/oj-projects/recurring-periods'
import { DEFAULT_PAYMENT_TERMS_DAYS } from '@/lib/vendors/paymentTerms'
import { invoiceStatusLabel, invoiceStatusTone } from '@/lib/invoices/status-ui'
import { ojProjectsLayout } from '../../_shared/nav'
import { OJ_MONEY_TEXT, ojActive, ojBalanceText, ojBalanceTone } from '../../_shared/status-ui'

/** This tab's page chrome: the same title, subtitle and tabs in every state. */
const LAYOUT = ojProjectsLayout('clients')

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
  end_date?: string | null
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
  payment_terms: String(DEFAULT_PAYMENT_TERMS_DAYS),
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

type DiscardedInstancesSummary = {
  count: number
  amountExVat: number
  periods: string[]
}

/**
 * Switching a charge off drops any months it had queued but never invoiced.
 * Those can be real money under cap billing, so always say what went.
 */
function describeDiscardedCharges(
  message: string,
  discarded?: DiscardedInstancesSummary
): string {
  if (!discarded || discarded.count < 1) return message
  const months = discarded.periods.join(', ')
  const plural = discarded.count === 1 ? 'month' : 'months'
  return `${message}. ${discarded.count} unbilled ${plural} (${months}) worth ${formatCurrency(discarded.amountExVat)} ex VAT were removed and can no longer be invoiced.`
}

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
    payment_terms: String(client.payment_terms ?? DEFAULT_PAYMENT_TERMS_DAYS),
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
  /** Set when the clients failed to load, so the page says so rather than showing none. */
  loadError?: string
}

export function ClientsClient({ initialClients, loadError }: ClientsClientProps): React.ReactElement {
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
  // A failed load in the drawer says so, rather than looking like an empty account.
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [chargesError, setChargesError] = useState<string | null>(null)
  const [loadingBillingSettings, setLoadingBillingSettings] = useState(false)
  const [billingForm, setBillingForm] = useState<BillingSettingsForm>(defaultBillingSettingsForm)
  const [billingSaving, setBillingSaving] = useState(false)
  const [recurringCharges, setRecurringCharges] = useState<RecurringCharge[]>([])
  const [loadingRecurringCharges, setLoadingRecurringCharges] = useState(false)
  const [chargeModalOpen, setChargeModalOpen] = useState(false)
  const [chargeForm, setChargeForm] = useState<RecurringChargeForm>(emptyRecurringChargeForm)
  const [chargeSaving, setChargeSaving] = useState(false)
  const [endingCharge, setEndingCharge] = useState<RecurringCharge | null>(null)
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
  const [workRecord, setWorkRecord] = useState<WorkRecordData | null>(null)
  const [loadingWorkRecord, setLoadingWorkRecord] = useState(false)
  const [sendingEmail, setSendingEmail] = useState(false)

  // Next-invoice preview state
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<any | null>(null)

  const previewVendor = useMemo(() => previewData?.vendors?.[0] || null, [previewData])
  const previewInvoice = useMemo(() => previewVendor?.invoice_preview || null, [previewVendor])

  const filtered = useMemo(() => {
    if (!search.trim()) return clients
    const q = search.toLowerCase()
    return clients.filter((c) => c.name.toLowerCase().includes(q))
  }, [clients, search])

  async function openDrawer(client: OJClientSummary): Promise<void> {
    setDrawerVendor(client)
    setBalance(null)
    setBalanceError(null)
    setChargesError(null)
    setRecurringCharges([])
    setBillingForm(defaultBillingSettingsForm)
    setStatement(null)
    setLoadingBalance(true)
    setLoadingRecurringCharges(true)
    setLoadingBillingSettings(true)

    // Default statement date range to the last 3 months. Built from the London
    // business date, not `new Date().toISOString()`, which lands a day early
    // between midnight and 01:00 BST.
    const today = getTodayIsoDate()
    setStatementFrom(`${addMonthsToIsoDate(today, -3).slice(0, 7)}-01`)
    setStatementTo(today)

    try {
      const [balanceRes, chargesRes, settingsRes] = await Promise.all([
        getClientBalance(client.id),
        getRecurringCharges(client.id),
        getVendorBillingSettings(client.id),
      ])

      if (balanceRes.error) {
        toast.error(balanceRes.error)
        setBalanceError(balanceRes.error)
      } else {
        setBalance(balanceRes.balance ?? null)
      }

      if (chargesRes.error) {
        toast.error(chargesRes.error)
        setChargesError(chargesRes.error)
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
      setBalanceError('Failed to load client details')
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
        setChargesError(res.error)
      } else {
        setChargesError(null)
        setRecurringCharges((res.charges ?? []) as RecurringCharge[])
      }
    } catch {
      toast.error('Failed to load recurring charges')
      setChargesError('Failed to load recurring charges')
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

      const discarded = (res as { discarded?: DiscardedInstancesSummary }).discarded
      toast.success(
        describeDiscardedCharges(
          chargeForm.id ? 'Recurring charge updated' : 'Recurring charge added',
          discarded
        )
      )
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

      toast.success(describeDiscardedCharges('Recurring charge disabled', res.discarded))
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

  async function loadWorkRecord(): Promise<void> {
    if (!drawerVendor || !statementFrom || !statementTo) return
    setLoadingWorkRecord(true)
    setWorkRecord(null)
    try {
      const res = await getWorkRecord(drawerVendor.id, statementFrom, statementTo)
      if (res.error) {
        toast.error(res.error)
        return
      }
      setWorkRecord(res.data ?? null)
    } finally {
      setLoadingWorkRecord(false)
    }
  }

  function downloadWorkRecordPdf(): void {
    if (!drawerVendor || !statementFrom || !statementTo) return
    const params = new URLSearchParams({
      vendorId: drawerVendor.id,
      dateFrom: statementFrom,
      dateTo: statementTo,
    })
    window.open(`/api/oj-projects/work-record?${params.toString()}`, '_blank', 'noopener')
  }

  function downloadStatementPdf(): void {
    if (!drawerVendor || !statementFrom || !statementTo) return
    const params = new URLSearchParams({
      vendorId: drawerVendor.id,
      dateFrom: statementFrom,
      dateTo: statementTo,
    })
    window.open(`/api/oj-projects/statement-pdf?${params.toString()}`, '_blank', 'noopener')
  }

  /**
   * Dry run of the monthly billing cron for this client, so the invoice can be
   * checked before it is raised and emailed automatically on the 1st. Creates
   * and sends nothing.
   */
  async function openPreview(): Promise<void> {
    if (!drawerVendor) return
    setPreviewLoading(true)
    setPreviewError(null)
    setPreviewData(null)
    try {
      const res = await fetch(
        `/api/oj-projects/billing-preview?vendor_id=${encodeURIComponent(drawerVendor.id)}`
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to load preview')
      setPreviewData(data)
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Failed to load preview')
    } finally {
      setPreviewLoading(false)
      setPreviewOpen(true)
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

  if (loadError) {
    return (
      <PageLayout {...LAYOUT}>
        <Alert tone="danger" title="Could not load clients">
          {loadError}
        </Alert>
      </PageLayout>
    )
  }

  return (
    <PageLayout
      {...LAYOUT}
      headerActions={
        canCreateClients ? (
          <Button
            variant="primary"
            size="sm"
            icon={<Icon name="plus" size={16} />}
            onClick={openCreateClient}
          >
            New Client
          </Button>
        ) : undefined
      }
    >
      {/* Search, directly above the list it filters */}
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search clients..."
          aria-label="Search clients"
          className="min-w-[220px] flex-1 sm:max-w-xs"
        />
      </div>

      <Card padding="none">
        {filtered.length === 0 ? (
          clients.length > 0 ? (
            <Empty size="sm" title="No clients match these filters" description="Try another client name." />
          ) : (
            <Empty size="sm" title="No clients yet" description="Clients you create show here." />
          )
        ) : (
          <>
            <div className="divide-y divide-border px-pad-card py-3 md:hidden">
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
          <PageLoading inline label="Loading balance" />
        ) : balanceError ? (
          <Alert tone="danger" title="Could not load this client's account">
            {balanceError}
          </Alert>
        ) : balance ? (
          <div className="flex flex-col gap-6">
            <Section title="Balance Summary">
              <StatGrid columns={2}>
                <Stat label="Unpaid Invoices (inc VAT)" value={formatCurrency(balance.unpaidInvoiceBalance)} />
                <Stat label="Unbilled Work (inc VAT)" value={formatCurrency(balance.unbilledTotal)} />
                <Stat
                  label="Total Outstanding (inc VAT)"
                  value={formatCurrency(balance.totalOutstanding)}
                  tone={ojBalanceTone(balance.totalOutstanding)}
                />
              </StatGrid>

              {/*
                Drafts are deliberately outside Total Outstanding: the client has
                never been sent them, so they are not owed. Shown here because a
                draft lingering for weeks usually means an invoice reissue was
                started and abandoned, which freezes the work it covers.
              */}
              {balance.draftInvoiceTotal > 0 && (
                <Alert tone="warning" role="status" className="mt-3">
                  <div className="flex items-center justify-between gap-3">
                    <span>Draft, not yet sent (excluded from the total)</span>
                    <span className="font-semibold">{formatCurrency(balance.draftInvoiceTotal)}</span>
                  </div>
                </Alert>
              )}

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
                  {/* Taken off the total above. Without this row the three
                      stats would not appear to add up. */}
                  {balance.invoicedOnAccountTotal > 0 && (
                    <div className="flex justify-between text-text-muted">
                      <span>Less already invoiced on account</span>
                      <span>-{formatCurrency(balance.invoicedOnAccountTotal)}</span>
                    </div>
                  )}
                </div>
              )}
            </Section>

            {/*
              The billing cron raises and emails this client's invoice
              automatically on the 1st with no human gate, so this is the only
              chance to see what it will send.
            */}
            <Section
              title="Next Invoice"
              description="Dry run of the monthly billing run. Nothing is created or sent."
              actions={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={openPreview}
                  loading={previewLoading}
                >
                  Preview Next Invoice
                </Button>
              }
            />

            {/* Invoices */}
            {balance.invoices.length > 0 && (
              <Section title="Recent Invoices">
                <div className="divide-y divide-border">
                  {balance.invoices.slice(0, 5).map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between py-2 text-sm">
                      <div>
                        <p className="font-medium">{inv.invoice_number}</p>
                        <p className="text-xs text-text-muted">{formatDateDdMmmmYyyy(inv.invoice_date)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{formatCurrency(inv.total_amount)}</p>
                        <Badge tone={invoiceStatusTone(inv.status)} dot>
                          {invoiceStatusLabel(inv.status)}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Billing settings */}
            <Section
              title="Billing Settings"
              actions={
                loadingBillingSettings ? <Spinner size="sm" label="Loading billing settings" /> : undefined
              }
            >
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
                  <FormFooter>
                    <Button type="submit" variant="primary" size="sm" loading={billingSaving}>
                      Save Billing Settings
                    </Button>
                  </FormFooter>
                )}
              </form>
            </Section>

            {/* Recurring charges */}
            <Section
              title="Recurring Charges"
              actions={
                canEditRecurringCharges ? (
                  <Button
                    variant="secondary"
                    size="xs"
                    icon={<Icon name="plus" size={14} />}
                    onClick={openCreateCharge}
                  >
                    Add Recurring Charge
                  </Button>
                ) : undefined
              }
            >
              {loadingRecurringCharges ? (
                <PageLoading inline label="Loading charges" />
              ) : chargesError ? (
                <Alert tone="danger" title="Could not load the recurring charges">
                  {chargesError}
                </Alert>
              ) : recurringCharges.length === 0 ? (
                <Empty size="sm" title="No recurring charges yet" />
              ) : (
                <div className="flex flex-col gap-2">
                  {recurringCharges.map((charge) => {
                    const incVat = calculateIncVat(Number(charge.amount_ex_vat || 0), Number(charge.vat_rate || 0))
                    return (
                      <Card key={charge.id} padding="sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-text">{charge.description}</p>
                            <p className="mt-1 text-xs text-text-muted">
                              {formatFrequency(charge.frequency)} · {formatCurrency(Number(charge.amount_ex_vat || 0))} ex VAT · {formatCurrency(incVat)} inc VAT
                            </p>
                          </div>
                          <Badge tone={charge.end_date ? 'neutral' : ojActive(charge.is_active).tone}>
                            {charge.end_date ? `${charge.end_date < getTodayIsoDate() ? 'Ended' : 'Ends'} ${formatDateDdMmmmYyyy(charge.end_date)}` : ojActive(charge.is_active).label}
                          </Badge>
                        </div>

                        {canEditRecurringCharges && !charge.end_date && (
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
                                key: 'end',
                                label: 'End charge',
                                icon: <Icon name="calendar" size={16} />,
                                onSelect: () => setEndingCharge(charge),
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
                      </Card>
                    )
                  })}
                </div>
              )}
            </Section>

            {/* Statement generator */}
            <Section title="Account Statement">
              <div className="grid grid-cols-1 gap-3 mb-3 sm:grid-cols-2">
                <Field label="From">
                  <Input
                    type="date"
                    value={statementFrom}
                    onChange={(e) => {
                      setStatementFrom(e.target.value)
                      // Clearing the preview stops an operator reviewing one
                      // range, widening it, seeing the old figures unchanged on
                      // screen, and emailing the client a different statement.
                      setStatement(null)
                      setWorkRecord(null)
                    }}
                  />
                </Field>
                <Field label="To">
                  <Input
                    type="date"
                    value={statementTo}
                    onChange={(e) => {
                      setStatementTo(e.target.value)
                      setStatement(null)
                      setWorkRecord(null)
                    }}
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
                  onClick={downloadStatementPdf}
                  disabled={!statementFrom || !statementTo}
                >
                  Download PDF
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

              {/* The Work Record answers a different question from the
                  statement: not what is owed, but where the time went and which
                  invoice charged it. Same dates, so it needs no controls. */}
              <div className="flex gap-2 mt-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={loadWorkRecord}
                  loading={loadingWorkRecord}
                >
                  Preview Work Record
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={downloadWorkRecordPdf}
                  disabled={!statementFrom || !statementTo}
                >
                  Download Work Record
                </Button>
              </div>

              {workRecord && (
                <Card padding="sm" className="mt-4 text-sm">
                  <p className="mb-2 text-xs font-medium text-text">
                    {workRecord.period.from} to {workRecord.period.to}
                  </p>
                  <p className="text-text-muted mb-2">
                    {workRecord.record.totalHours.toFixed(2)} hours across{' '}
                    {workRecord.record.projectCount} project
                    {workRecord.record.projectCount === 1 ? '' : 's'}
                    {workRecord.record.notYetChargedHours > 0
                      ? `, of which ${workRecord.record.notYetChargedHours.toFixed(2)} not yet invoiced`
                      : ''}
                  </p>
                  {workRecord.account && (
                    <p className="text-text-muted mb-2">
                      {formatCurrency(workRecord.account.position.invoicedUnpaid)} invoiced and unpaid,{' '}
                      {formatCurrency(workRecord.account.position.notYetInvoicedNet)} still to be invoiced
                      {workRecord.account.forecast?.rows.length
                        ? ` over ${workRecord.account.forecast.rows.length} invoice${workRecord.account.forecast.rows.length === 1 ? '' : 's'}`
                        : ''}
                    </p>
                  )}
                  {!workRecord.record.reconciles && (
                    <Alert tone="danger" className="mb-2">
                      {workRecord.record.unexplainedInvoices?.length
                        ? `${workRecord.record.unexplainedInvoices.join(', ')} ${workRecord.record.unexplainedInvoices.length === 1 ? 'has' : 'have'} no work recorded against ${workRecord.record.unexplainedInvoices.length === 1 ? 'it' : 'them'}, so this document would not agree with the account statement. Link the work it covered, or credit it, before sending anything to the client.`
                        : 'These figures do not add up against the invoices, so no PDF can be produced. Please check the entries before sending anything to the client.'}
                    </Alert>
                  )}
                  <div className="max-h-[200px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="px-2">Project</TableHead>
                          <TableHead align="right" className="px-2">Hours</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {workRecord.record.projects.map((p) => (
                          <TableRow key={p.project}>
                            <TableCell className="px-2 whitespace-normal">{p.project}</TableCell>
                            <TableCell align="right" className="px-2">{p.hours.toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </Card>
              )}

              {/* Statement preview */}
              {statement && (
                <Card padding="sm" className="mt-4 text-sm">
                  {/* The period is stated so the preview can never be mistaken
                      for a different range than the one it covers. */}
                  <p className="mb-2 text-xs font-medium text-text">
                    {statement.period.from} to {statement.period.to}
                  </p>
                  <div className="flex justify-between mb-2 text-text-muted">
                    <span>Opening balance</span>
                    <span className="font-medium">{formatCurrency(statement.openingBalance)}</span>
                  </div>
                  {statement.transactions.length === 0 ? (
                    <Empty size="sm" title="No transactions for this period" />
                  ) : (
                    <div className="max-h-[200px] overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="px-2">Date</TableHead>
                            <TableHead className="px-2">Description</TableHead>
                            <TableHead align="right" className="px-2">Debit</TableHead>
                            <TableHead align="right" className="px-2">Credit</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {statement.transactions.map((txn, i) => (
                            <TableRow key={i}>
                              <TableCell className="px-2">{txn.date}</TableCell>
                              <TableCell className="px-2 truncate max-w-[120px]">{txn.description}</TableCell>
                              <TableCell align="right" className="px-2">{txn.debit != null ? formatCurrency(txn.debit) : ''}</TableCell>
                              <TableCell align="right" className={cn('px-2', OJ_MONEY_TEXT.received)}>{txn.credit != null ? formatCurrency(txn.credit) : ''}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  <div className="flex justify-between mt-2 pt-2 border-t border-border font-medium">
                    <span>Closing balance</span>
                    <span className={ojBalanceText(statement.closingBalance)}>
                      {formatCurrency(statement.closingBalance)}
                    </span>
                  </div>
                  {statement.position && statement.position.notYetInvoicedNet > 0 && (
                    <>
                      <div className="flex justify-between mt-1 text-text-muted">
                        <span>Work done, not yet invoiced</span>
                        <span>{formatCurrency(statement.position.notYetInvoicedNet)}</span>
                      </div>
                      <div className="flex justify-between mt-1 font-medium">
                        <span>Total for all work to date</span>
                        <span>{formatCurrency(statement.closingBalance + statement.position.notYetInvoicedNet)}</span>
                      </div>
                    </>
                  )}
                </Card>
              )}
            </Section>
          </div>
        ) : (
          <Empty size="sm" title="Select a client to view balance details" />
        )}
      </Drawer>

      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={previewVendor?.statement_mode ? 'Statement Invoice Preview (Dry Run)' : 'Invoice Preview (Dry Run)'}
        width="lg"
        footer={
          <Button variant="secondary" onClick={() => setPreviewOpen(false)}>
            Close
          </Button>
        }
      >
        <div className="flex flex-col gap-4 text-sm">
          <Alert tone="info" role="status">
            Dry run for the period the next billing run will invoice. No invoice is created or sent.
          </Alert>

          {previewError && <Alert tone="danger">{previewError}</Alert>}

          {!previewError && previewVendor && !previewVendor.would_invoice && (
            <Alert tone="warning" role="status">
              {previewVendor.reason || 'No invoice would be generated for this period.'}
            </Alert>
          )}

          {!previewError && previewInvoice && (
            <div className="flex flex-col gap-4">
              <DescriptionList
                columns={2}
                items={[
                  { key: 'period', label: 'Billing period', value: previewData?.period },
                  { key: 'invoice-date', label: 'Invoice date', value: previewInvoice.invoice_date },
                  { key: 'due-date', label: 'Due date', value: previewInvoice.due_date },
                  { key: 'reference', label: 'Reference', value: previewInvoice.reference },
                ]}
              />

              <Card padding="sm">
                <p className="text-xs text-text-muted mb-2">Totals (ex VAT)</p>
                <div className="flex justify-between font-semibold">
                  <span>Subtotal</span>
                  <span>
                    {formatCurrency(Number(previewInvoice.totals?.subtotalBeforeInvoiceDiscount || 0))}
                  </span>
                </div>
                <p className="mt-1 text-xs text-text-muted">VAT is added when the invoice is sent.</p>
              </Card>

              <div>
                <p className="text-xs text-text-muted mb-2">Line items</p>
                <Card padding="none">
                  <div className="divide-y divide-border">
                    {(previewInvoice.line_items || []).map((item: any, idx: number) => {
                      const qty = Number(item.quantity || 0)
                      const unit = Number(item.unit_price || 0)
                      return (
                        <div key={`${item.description}-${idx}`} className="px-3 py-2">
                          <p className="font-medium">{item.description}</p>
                          <p className="text-xs text-text-muted">
                            Qty {qty} at {formatCurrency(unit)} ex VAT
                          </p>
                          <p className="font-semibold">{formatCurrency(qty * unit)}</p>
                        </div>
                      )
                    })}
                  </div>
                </Card>
              </div>

              {previewInvoice.notes && (
                <div>
                  <p className="text-xs text-text-muted mb-2">Notes</p>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs">
                    {previewInvoice.notes}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={clientModalOpen}
        onClose={() => setClientModalOpen(false)}
        title={clientForm.id ? 'Edit Client' : 'New Client'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setClientModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="oj-client-form"
              variant="primary"
              loading={clientSaving}
            >
              {clientForm.id ? 'Save Changes' : 'Create Client'}
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

      {endingCharge && (
        <EndRecurringChargeModal
          key={endingCharge.id}
          charge={endingCharge}
          onClose={() => setEndingCharge(null)}
          onEnded={async () => {
            await reloadRecurringCharges()
            if (drawerVendor) {
              const result = await getClientBalance(drawerVendor.id)
              if (result.error) setBalanceError(result.error)
              else setBalance(result.balance ?? null)
            }
          }}
        />
      )}

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
              variant="primary"
              loading={chargeSaving}
            >
              {chargeForm.id ? 'Save Changes' : 'Add Recurring Charge'}
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
            <Field
              label="Frequency"
              required
              hint="Quarterly and annual charges go out on the next monthly invoice, then repeat every 3 or 12 months from there."
            >
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

      {/* Red, not orange: disabling also removes the charge's unbilled months, which can then
          never be invoiced (disableRecurringCharge, and the toast in handleDisableCharge). */}
      <ConfirmDialog
        open={!!disableChargeId}
        onClose={() => setDisableChargeId(null)}
        onConfirm={handleDisableCharge}
        title="Disable Recurring Charge"
        message="Disable this recurring charge? It stops being included in future billing runs, and any unbilled months are removed and can no longer be invoiced."
        confirmLabel="Disable"
        tone="danger"
      />

      <ConfirmDialog
        open={!!deleteClientId}
        onClose={() => setDeleteClientId(null)}
        onConfirm={handleDeleteClient}
        title="Delete Client"
        message="Delete this client? A client with projects or invoices is deactivated instead of permanently deleted."
        confirmLabel="Delete"
        tone="danger"
      />
    </PageLayout>
  )
}
