import { redirect } from 'next/navigation'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Empty,
  Input,
  LinkButton,
  PageLayout,
  Stat,
  StatGrid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds'
import { Icon } from '@/ds/icons'
import { checkUserPermission } from '@/app/actions/rbac'
import { cashingUpLayout } from '../_shared/nav'
import { ONLINE_INCOME_STATUS_TONE } from '../_shared/status-ui'
import {
  ONLINE_INCOME_SOURCE_LABELS,
  ONLINE_INCOME_STATUS_LABELS,
  loadOnlineIncome,
  summariseOnlineIncome,
  type OnlineIncomeRow,
} from '@/lib/finance/online-income'
import { resolveOnlineIncomeRange } from '@/lib/finance/online-income-range'
import { formatDateInLondon } from '@/lib/dateUtils'

export const dynamic = 'force-dynamic'

const SUBTITLE = 'Online Income: deposits, tickets, hire payments and parking taken online'

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
}

function formatDay(value: string | null): string {
  if (!value) return '-'
  return formatDateInLondon(`${value}T12:00:00Z`, { day: 'numeric', month: 'short', year: 'numeric' })
}

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Money taken online (BK-117; owner decision D33): what was taken, refunded and kept, and what
 * PayPal charged, by the day the money was taken. Online booking money is its own line in the P&L
 * and is kept off the till.
 */
export default async function OnlineIncomePage({ searchParams }: PageProps) {
  const canView = await checkUserPermission('cashing_up', 'view')
  if (!canView) redirect('/unauthorized')

  const params = searchParams ? await searchParams : {}
  const range = resolveOnlineIncomeRange(firstParam(params.from), firstParam(params.to))

  let rows: OnlineIncomeRow[] = []
  let loadError: string | null = null
  try {
    rows = await loadOnlineIncome(range)
  } catch {
    loadError = 'Online income could not be loaded. Try again, and tell a manager if it keeps failing.'
  }
  const summary = summariseOnlineIncome(rows)
  const exportHref = `/api/cashing-up/online-income/export?from=${range.from}&to=${range.to}`

  return (
    <PageLayout
      {...cashingUpLayout(SUBTITLE)}
      headerActions={
        <LinkButton
          href={exportHref}
          download
          variant="secondary"
          size="sm"
          icon={<Icon name="download" size={14} />}
          disabled={Boolean(loadError) || rows.length === 0}
        >
          Download CSV
        </LinkButton>
      }
    >
      <Card>
        <CardBody>
          <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Input label="From" type="date" name="from" defaultValue={range.from} />
            <Input label="To" type="date" name="to" defaultValue={range.to} />
            <Button type="submit" variant="secondary" size="sm">Show</Button>
          </form>
          {range.adjusted && (
            <p className="mt-2 text-sm text-text-muted">
              Those dates could not be used (oldest first, at most 400 days), so this shows this month so far.
            </p>
          )}
        </CardBody>
      </Card>

      {loadError ? (
        <Alert tone="danger">{loadError}</Alert>
      ) : (
        <>
          <StatGrid columns={5}>
            <Stat label="Taken online" value={formatCurrency(summary.total.gross)} hint={`${summary.total.count} payments`} />
            <Stat label="Refunded" value={formatCurrency(summary.total.refunded)} />
            <Stat label="Net" value={formatCurrency(summary.total.net)} />
            <Stat
              label="Online booking income"
              value={formatCurrency(summary.bookingMoneyNet)}
              hint="The P&L line: not in till sales"
            />
            <Stat
              label="PayPal fees"
              value={formatCurrency(summary.total.paypalFees)}
              hint={summary.total.feesUnknown > 0 ? `Not recorded for ${summary.total.feesUnknown} older payments` : 'An expense'}
            />
          </StatGrid>

          <Alert tone="info" size="sm">
            Online money is kept off the till: ring it through the till as well and it is counted twice. Door money
            recorded by hand and anything paid at the till are in the cash-up, not here. Each payment is dated by the
            day it was taken, with any refund taken off.
          </Alert>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="By kind" />
              {summary.bySource.length === 0 ? (
                <Empty size="sm" title="Nothing taken online in these dates" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kind</TableHead>
                      <TableHead align="right">Payments</TableHead>
                      <TableHead align="right">Gross</TableHead>
                      <TableHead align="right">Refunded</TableHead>
                      <TableHead align="right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.bySource.map((line) => (
                      <TableRow key={line.source}>
                        <TableCell>{line.label}</TableCell>
                        <TableCell align="right">{line.totals.count}</TableCell>
                        <TableCell align="right">{formatCurrency(line.totals.gross)}</TableCell>
                        <TableCell align="right">{formatCurrency(line.totals.refunded)}</TableCell>
                        <TableCell align="right">{formatCurrency(line.totals.net)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>

            <Card>
              <CardHeader title="Where the money stands" />
              {summary.byStatus.length === 0 ? (
                <Empty size="sm" title="Nothing taken online in these dates" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead align="right">Payments</TableHead>
                      <TableHead align="right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.byStatus.map((line) => (
                      <TableRow key={line.status}>
                        <TableCell>{line.label}</TableCell>
                        <TableCell align="right">{line.count}</TableCell>
                        <TableCell align="right">{formatCurrency(line.net)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader title="Payments" subtitle={`${formatDay(range.from)} to ${formatDay(range.to)}`} />
            {rows.length === 0 ? (
              <Empty size="sm" title="Nothing taken online in these dates" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Taken</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Visit</TableHead>
                    <TableHead align="right">Gross</TableHead>
                    <TableHead align="right">Refunded</TableHead>
                    <TableHead align="right">Net</TableHead>
                    <TableHead align="right">PayPal fee</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={`${row.source}:${row.sourceId}`}>
                      <TableCell>{formatDay(row.moneyDate)}</TableCell>
                      <TableCell>
                        {ONLINE_INCOME_SOURCE_LABELS[row.source] ?? row.source}
                        {!row.isBookingMoney && <span className="block text-xs text-text-muted">Not a booking</span>}
                      </TableCell>
                      <TableCell>{row.reference ?? '-'}</TableCell>
                      <TableCell>{formatDay(row.visitDate)}</TableCell>
                      <TableCell align="right">{formatCurrency(row.gross)}</TableCell>
                      <TableCell align="right">{row.refunded > 0 ? formatCurrency(row.refunded) : '-'}</TableCell>
                      <TableCell align="right">{formatCurrency(row.net)}</TableCell>
                      <TableCell align="right">{row.paypalFee === null ? '-' : formatCurrency(row.paypalFee)}</TableCell>
                      <TableCell>
                        <Badge tone={ONLINE_INCOME_STATUS_TONE[row.status] ?? 'neutral'} size="sm">{ONLINE_INCOME_STATUS_LABELS[row.status] ?? row.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      )}
    </PageLayout>
  )
}
