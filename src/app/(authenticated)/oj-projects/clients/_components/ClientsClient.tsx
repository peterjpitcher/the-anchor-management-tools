'use client'

import { useMemo, useState } from 'react'
import {
  Card,
  CardHeader,
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
  Field,
  Input,
  Empty,
  Stat,
  toast,
} from '@/ds'
import { getClientBalance } from '@/app/actions/oj-projects/client-balance'
import { getClientStatement, sendStatementEmail } from '@/app/actions/oj-projects/client-statement'
import type { ClientBalance } from '@/app/actions/oj-projects/client-balance'
import type { ClientStatementData } from '@/app/actions/oj-projects/client-statement'
import { formatDateDdMmmmYyyy } from '@/lib/dateUtils'

function formatCurrency(value: number): string {
  return `£${value.toFixed(2)}`
}

interface ClientSummary {
  id: string
  name: string
  projectCount: number
}

interface ClientsClientProps {
  initialClients: ClientSummary[]
}

export function ClientsClient({ initialClients }: ClientsClientProps): React.ReactElement {
  const [search, setSearch] = useState('')
  const [drawerVendor, setDrawerVendor] = useState<ClientSummary | null>(null)
  const [balance, setBalance] = useState<ClientBalance | null>(null)
  const [loadingBalance, setLoadingBalance] = useState(false)

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

  async function openDrawer(client: ClientSummary): Promise<void> {
    setDrawerVendor(client)
    setBalance(null)
    setStatement(null)
    setLoadingBalance(true)

    // Default statement date range to last 3 months
    const now = new Date()
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1)
    setStatementFrom(threeMonthsAgo.toISOString().split('T')[0])
    setStatementTo(now.toISOString().split('T')[0])

    try {
      const res = await getClientBalance(client.id)
      if (res.error) {
        toast.error(res.error)
      } else {
        setBalance(res.balance ?? null)
      }
    } catch {
      toast.error('Failed to load balance')
    } finally {
      setLoadingBalance(false)
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
    </div>
  )
}
