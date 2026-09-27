import { getReceiptMissingExpenseSummary } from '@/app/actions/receipts'
import {
  Card,
  CardBody,
  CardHeader,
  Empty,
  LinkButton,
  Stat,
  StatGrid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { ReceiptsPageChrome } from '../_components/ReceiptsPageChrome'
import { RECEIPT_FLOW_TEXT_CLASS, RECEIPT_FLOW_TONE } from '../_shared/status-ui'

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
  }).format(value ?? 0)
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('en-GB', { timeZone: 'UTC' })
}

/** The workspace, filtered to this vendor's transactions that still need an expense category. */
function reviewHref(vendorLabel: string): string {
  return `/receipts?needsExpense=1${vendorLabel !== 'Unassigned vendor' ? `&search=${encodeURIComponent(vendorLabel)}` : ''}`
}

const ALL_CATEGORISED = 'No expense gaps'

export const runtime = 'nodejs'

export default async function ReceiptsMissingExpensePage() {
  const [canView, canManage] = await Promise.all([
    checkUserPermission('receipts', 'view'),
    checkUserPermission('receipts', 'manage'),
  ])
  if (!canView) {
    redirect('/unauthorized')
  }

  const summary = await getReceiptMissingExpenseSummary()
  const totalTransactions = summary.reduce((sum, item) => sum + item.transactionCount, 0)
  const totalOutgoing = summary.reduce((sum, item) => sum + item.totalOutgoing, 0)
  const totalIncoming = summary.reduce((sum, item) => sum + item.totalIncoming, 0)

  return (
    <ReceiptsPageChrome
      subtitle="Expense Gaps: vendors whose transactions still need an expense category"
      navState={{ view: 'missing-expense' }}
      canManage={canManage}
    >
      <StatGrid columns={3}>
        {/* Amber while anything needs a category; money out red and money in green, as in the table below. */}
        <Stat
          label="Transactions without expense"
          value={totalTransactions}
          tone={totalTransactions > 0 ? 'warning' : 'default'}
          hint="Needs attention"
        />
        <Stat
          label="Uncategorised outgoing"
          value={formatCurrency(totalOutgoing)}
          tone={totalOutgoing > 0 ? RECEIPT_FLOW_TONE.spend : 'default'}
          hint="Awaiting categorisation"
        />
        <Stat
          label="Uncategorised incoming"
          value={formatCurrency(totalIncoming)}
          tone={totalIncoming > 0 ? RECEIPT_FLOW_TONE.income : 'default'}
          hint="Incoming balance"
        />
      </StatGrid>

      {summary.length === 0 ? (
        <Card>
          <Empty size="sm" title={ALL_CATEGORISED} description="Every transaction has an expense category." />
        </Card>
      ) : (
        <>
          {/* Desktop and tablet: table (from 768px) */}
          <Card padding="none" className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead align="right">Transactions</TableHead>
                  <TableHead align="right">Total out</TableHead>
                  <TableHead align="right">Total in</TableHead>
                  <TableHead>Latest activity</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.map((item) => (
                  <TableRow key={item.vendorLabel}>
                    <TableCell className="font-medium text-text-strong">{item.vendorLabel}</TableCell>
                    <TableCell align="right" className="tabular-nums">{item.transactionCount}</TableCell>
                    <TableCell align="right" className={`tabular-nums ${RECEIPT_FLOW_TEXT_CLASS.spend}`}>{formatCurrency(item.totalOutgoing)}</TableCell>
                    <TableCell align="right" className={`tabular-nums ${RECEIPT_FLOW_TEXT_CLASS.income}`}>{formatCurrency(item.totalIncoming)}</TableCell>
                    <TableCell className="text-text-muted">{formatDate(item.latestTransaction)}</TableCell>
                    <TableCell align="right">
                      <LinkButton href={reviewHref(item.vendorLabel)} variant="secondary" size="sm">
                        Review
                      </LinkButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Phones: one card per vendor (below 768px) */}
          <div className="space-y-3 md:hidden">
            {summary.map((item) => (
              <Card key={item.vendorLabel}>
                <CardHeader title={item.vendorLabel} />
                <CardBody className="space-y-3">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-text-muted">Transactions</dt>
                      <dd className="mt-0.5 font-medium text-text-strong tabular-nums">{item.transactionCount}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-text-muted">Latest activity</dt>
                      <dd className="mt-0.5 font-medium text-text-muted">{formatDate(item.latestTransaction)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-text-muted">Total out</dt>
                      <dd className={`mt-0.5 font-medium tabular-nums ${RECEIPT_FLOW_TEXT_CLASS.spend}`}>{formatCurrency(item.totalOutgoing)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-text-muted">Total in</dt>
                      <dd className={`mt-0.5 font-medium tabular-nums ${RECEIPT_FLOW_TEXT_CLASS.income}`}>{formatCurrency(item.totalIncoming)}</dd>
                    </div>
                  </dl>
                  <LinkButton href={reviewHref(item.vendorLabel)} variant="secondary" size="sm" className="w-full">
                    Review
                  </LinkButton>
                </CardBody>
              </Card>
            ))}
          </div>
        </>
      )}
    </ReceiptsPageChrome>
  )
}
