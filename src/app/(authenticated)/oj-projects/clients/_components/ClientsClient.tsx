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
  Select,
  Checkbox,
  Empty,
  ConfirmDialog,
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
import type { OJClientSummary } from '@/app/actions/oj-projects/clients'
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

const emptyRecurringChargeForm: RecurringChargeForm = {
  description: '',
  amount_ex_vat: '',
  vat_rate: '20',
  frequency: 'monthly',
  is_active: true,
  sort_order: '0',
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

interface ClientsClientProps {
  initialClients: OJClientSummary[]
}

export function ClientsClient({ initialClients }: ClientsClientProps): React.ReactElement {
  const { hasPermission } = usePermissions()
  const canEditRecurringCharges = hasPermission('oj_projects', 'edit')

  const [search, setSearch] = useState('')
  const [drawerVendor, setDrawerVendor] = useState<OJClientSummary | null>(null)
  const [balance, setBalance] = useState<ClientBalance | null>(null)
  const [loadingBalance, setLoadingBalance] = useState(false)
  const [recurringCharges, setRecurringCharges] = useState<RecurringCharge[]>([])
  const [loadingRecurringCharges, setLoadingRecurringCharges] = useState(false)
  const [chargeModalOpen, setChargeModalOpen] = useState(false)
  const [chargeForm, setChargeForm] = useState<RecurringChargeForm>(emptyRecurringChargeForm)
  const [chargeSaving, setChargeSaving] = useState(false)
  const [disableChargeId, setDisableChargeId] = useState<string | null>(null)

  // Statement state
  const [statementFrom, setStatementFrom] = useState('')
  const [statementTo, setStatementTo] = useState('')
  const [statement, setStatement] = useState<ClientStatementData | null>(null)
  const [loadingStatement, setLoadingStatement] = useState(false)
  const [sendingEmail, setSendingEmail] = useState(false)

  const filtered = useMemo(() => {
    if (!search.trim()) return initialClients
    const q = search.toLowerCase()
    return initialClients.filter((c) => c.name.toLowerCase().includes(q))
  }, [initialClients, search])

  async function openDrawer(client: OJClientSummary): Promise<void> {
    setDrawerVendor(client)
    setBalance(null)
    setRecurringCharges([])
    setStatement(null)
    setLoadingBalance(true)
    setLoadingRecurringCharges(true)

    // Default statement date range to last 3 months
    const now = new Date()
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1)
    setStatementFrom(threeMonthsAgo.toISOString().split('T')[0])
    setStatementTo(now.toISOString().split('T')[0])

    try {
      const [balanceRes, chargesRes] = await Promise.all([
        getClientBalance(client.id),
        getRecurringCharges(client.id),
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
    } catch {
      toast.error('Failed to load client details')
    } finally {
      setLoadingBalance(false)
      setLoadingRecurringCharges(false)
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
      <div className="flex gap-3 items-center">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search clients..."
          className="flex-1 sm:max-w-xs"
        />
      </div>

      {/* Clients Table */}
      <Card>
        {filtered.length === 0 ? (
          <Empty title="No clients" description="No clients found." />
        ) : (
          <Table>
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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openDrawer(client)}
                    >
                      View Balance
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
              <div className="grid grid-cols-2 gap-3">
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
                          <div className="mt-3 flex gap-2">
                            <Button
                              variant="ghost"
                              size="xs"
                              icon={<Icon name="edit" size={14} />}
                              onClick={() => openEditCharge(charge)}
                            >
                              Edit
                            </Button>
                            {charge.is_active && (
                              <Button
                                variant="ghost"
                                size="xs"
                                icon={<Icon name="x" size={14} />}
                                onClick={() => setDisableChargeId(charge.id)}
                              >
                                Disable
                              </Button>
                            )}
                          </div>
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
              <div className="grid grid-cols-2 gap-3 mb-3">
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
                    <div className="max-h-[200px] overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-1">Date</th>
                            <th className="text-left py-1">Description</th>
                            <th className="text-right py-1">Debit</th>
                            <th className="text-right py-1">Credit</th>
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

          <div className="grid grid-cols-2 gap-3">
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

          <div className="grid grid-cols-2 gap-3">
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
    </div>
  )
}
