import Link from 'next/link'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getVoucherSummary } from '@/app/actions/vouchers'
import {
  PageLayout,
  LinkButton,
  Card,
  Alert,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/ds'
import { getLocalIsoDateDaysAgo, formatDateInLondon } from '@/lib/dateUtils'
import type { VoucherAgeBucket } from '@/types/vouchers'
import { formatPence, ledgerHref, VOUCHER_SECTION_NAV } from './_shared/voucher-ui'

export const dynamic = 'force-dynamic'

const AGE_BUCKET_LABELS: Record<VoucherAgeBucket, string> = {
  '0-30': '0 to 30 days',
  '31-90': '31 to 90 days',
  '91-180': '91 to 180 days',
  '181+': '181 days and older',
}

function ageBucketHref(bucket: VoucherAgeBucket): string {
  switch (bucket) {
    case '0-30':
      return ledgerHref({ status: 'issued', issuedFrom: getLocalIsoDateDaysAgo(30) })
    case '31-90':
      return ledgerHref({
        status: 'issued',
        issuedFrom: getLocalIsoDateDaysAgo(90),
        issuedTo: getLocalIsoDateDaysAgo(31),
      })
    case '91-180':
      return ledgerHref({
        status: 'issued',
        issuedFrom: getLocalIsoDateDaysAgo(180),
        issuedTo: getLocalIsoDateDaysAgo(91),
      })
    case '181+':
      return ledgerHref({ status: 'issued', issuedTo: getLocalIsoDateDaysAgo(181) })
  }
}

export default async function VouchersOverviewPage() {
  const canManage = await checkUserPermission('vouchers', 'manage')
  if (!canManage) redirect('/unauthorized')

  const summaryResult = await getVoucherSummary()

  if (summaryResult.error || !summaryResult.data) {
    return (
      <PageLayout title="Vouchers" navItems={VOUCHER_SECTION_NAV}>
        <Alert tone="danger" title="Could not load the voucher overview">
          {summaryResult.error ?? 'Something went wrong. Refresh to try again.'}
        </Alert>
      </PageLayout>
    )
  }

  const summary = summaryResult.data
  const tiles = [
    {
      label: 'In stock',
      value: summary.tiles.totalInStock,
      hint: 'Printed cards ready to hand out',
      href: ledgerHref({ status: 'generated', batchReady: 1 }),
    },
    {
      label: 'Outstanding',
      value: summary.tiles.totalOutstanding,
      hint: 'Issued and not yet redeemed, as of the last expiry run',
      href: ledgerHref({ status: 'issued' }),
    },
    {
      label: 'Redeemed this month',
      value: summary.tiles.redeemedThisMonth,
      hint: 'Includes redemptions despite expiry',
      href: ledgerHref({
        status: 'redeemed',
        redeemedFrom: summary.monthStartIso,
        redeemedTo: summary.todayIso,
      }),
    },
    {
      label: 'Outstanding value',
      value: formatPence(summary.tiles.outstandingValuePence) || '£0',
      hint: 'Issued £-value vouchers only',
      href: ledgerHref({ status: 'issued' }),
    },
  ]

  return (
    <PageLayout
      title="Vouchers"
      subtitle="Prize voucher stock, hand-outs and redemptions"
      navItems={VOUCHER_SECTION_NAV}
      headerActions={
        <div className="flex gap-2">
          <LinkButton href="/vouchers/handout" variant="secondary">
            Hand-out mode
          </LinkButton>
          <LinkButton href="/vouchers/generate" variant="primary">
            Generate vouchers
          </LinkButton>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {tiles.map((tile) => (
            <Link key={tile.label} href={tile.href} className="block">
              <Card className="h-full hover:border-gray-400 transition-colors">
                <div className="text-sm text-gray-500">{tile.label}</div>
                <div className="mt-1 text-3xl font-semibold text-gray-900">{tile.value}</div>
                <div className="mt-1 text-xs text-gray-500">{tile.hint}</div>
              </Card>
            </Link>
          ))}
        </div>

        {summary.notPrintable.length > 0 && (
          <Alert tone="warning" title="Not yet printable">
            <div className="space-y-1">
              <p>
                These batches are not counted as stock until their PDF is rendered and marked
                ready.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                {summary.notPrintable.map((batch) => (
                  <li key={batch.batchId}>
                    <Link
                      href={`/vouchers/generate?batch=${batch.batchId}`}
                      className="underline underline-offset-2"
                    >
                      {formatDateInLondon(batch.createdAt, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                      {', '}
                      {batch.totalCount} cards, {batch.pdfStatus}
                      {batch.renderError ? `: ${batch.renderError}` : ''}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </Alert>
        )}

        <Card title="Stock by type" subtitle="In stock counts printed cards in batches marked ready">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Voucher type</TableHead>
                  <TableHead align="right">In stock</TableHead>
                  <TableHead align="right">Out (issued)</TableHead>
                  <TableHead align="right">Redeemed</TableHead>
                  <TableHead align="right">Expired</TableHead>
                  <TableHead align="right">Cancelled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.stock.map((row) => (
                  <TableRow key={row.typeId}>
                    <TableCell>
                      <span className="font-medium text-gray-900">{row.displayTitle}</span>
                      {row.lowStock && (
                        <span className="ml-2 align-middle">
                          <Badge tone="warning">Low stock</Badge>
                        </span>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Link
                        href={ledgerHref({ status: 'generated', batchReady: 1, type: row.typeId })}
                        className="font-semibold underline-offset-2 hover:underline"
                      >
                        {row.inStock}
                      </Link>
                    </TableCell>
                    <TableCell align="right">
                      <Link
                        href={ledgerHref({ status: 'issued', type: row.typeId })}
                        className="underline-offset-2 hover:underline"
                      >
                        {row.issued}
                      </Link>
                    </TableCell>
                    <TableCell align="right">
                      <Link
                        href={ledgerHref({ status: 'redeemed', type: row.typeId })}
                        className="underline-offset-2 hover:underline"
                      >
                        {row.redeemed}
                      </Link>
                    </TableCell>
                    <TableCell align="right">
                      <Link
                        href={ledgerHref({ status: 'expired', type: row.typeId })}
                        className="underline-offset-2 hover:underline"
                      >
                        {row.expired}
                      </Link>
                    </TableCell>
                    <TableCell align="right">
                      <Link
                        href={ledgerHref({ status: 'cancelled', type: row.typeId })}
                        className="underline-offset-2 hover:underline"
                      >
                        {row.cancelled}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell>
                    <span className="font-semibold text-gray-900">Total</span>
                  </TableCell>
                  <TableCell align="right">
                    <span className="font-semibold">{summary.totals.inStock}</span>
                  </TableCell>
                  <TableCell align="right">
                    <span className="font-semibold">{summary.totals.issued}</span>
                  </TableCell>
                  <TableCell align="right">
                    <span className="font-semibold">{summary.totals.redeemed}</span>
                  </TableCell>
                  <TableCell align="right">
                    <span className="font-semibold">{summary.totals.expired}</span>
                  </TableCell>
                  <TableCell align="right">
                    <span className="font-semibold">{summary.totals.cancelled}</span>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </Card>

        <Card
          title="Outstanding by age"
          subtitle="Completed London days since hand-out, alongside expiry"
        >
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {summary.ageBuckets.map((bucket) => (
              <Link key={bucket.bucket} href={ageBucketHref(bucket.bucket)} className="block">
                <div className="rounded-lg border border-gray-200 p-4 hover:border-gray-400 transition-colors">
                  <div className="text-sm text-gray-500">{AGE_BUCKET_LABELS[bucket.bucket]}</div>
                  <div className="mt-1 text-2xl font-semibold text-gray-900">{bucket.count}</div>
                </div>
              </Link>
            ))}
            <Link
              href={ledgerHref({ status: 'issued', expiringWithinDays: 14 })}
              className="block"
            >
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 hover:border-amber-500 transition-colors">
                <div className="text-sm text-amber-800">Expiring within 14 days</div>
                <div className="mt-1 text-2xl font-semibold text-amber-900">
                  {summary.expiringSoon}
                </div>
              </div>
            </Link>
          </div>
        </Card>
      </div>
    </PageLayout>
  )
}
