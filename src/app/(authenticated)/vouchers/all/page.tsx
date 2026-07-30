import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getVoucherLedger, listVoucherTypes, listVoucherBatches } from '@/app/actions/vouchers'
import type { VoucherLedgerFilters } from '@/app/actions/vouchers'
import { PageLayout, Alert } from '@/ds'
import type { VoucherStatus } from '@/types/vouchers'
import { VOUCHER_SECTION_NAV } from '../_shared/voucher-ui'
import { LedgerClient } from './LedgerClient'

export const dynamic = 'force-dynamic'

const VALID_STATUSES: VoucherStatus[] = [
  'generated',
  'issued',
  'redeemed',
  'expired',
  'cancelled',
  'replaced',
]

type SearchParams = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function parseLedgerFilters(params: SearchParams): VoucherLedgerFilters {
  const statusParam = firstValue(params.status)
  const typeParam = firstValue(params.type)
  const expiringParam = firstValue(params.expiringWithinDays)
  const pageParam = firstValue(params.page)

  const status = statusParam
    ? (statusParam
        .split(',')
        .filter((entry): entry is VoucherStatus =>
          (VALID_STATUSES as string[]).includes(entry)
        ) as VoucherStatus[])
    : undefined

  return {
    status: status && status.length > 0 ? status : undefined,
    typeIds: typeParam ? typeParam.split(',').filter(Boolean) : undefined,
    batchId: firstValue(params.batch) || undefined,
    eventId: firstValue(params.event) || undefined,
    customerId: firstValue(params.customer) || undefined,
    generatedFrom: firstValue(params.generatedFrom) || undefined,
    generatedTo: firstValue(params.generatedTo) || undefined,
    issuedFrom: firstValue(params.issuedFrom) || undefined,
    issuedTo: firstValue(params.issuedTo) || undefined,
    redeemedFrom: firstValue(params.redeemedFrom) || undefined,
    redeemedTo: firstValue(params.redeemedTo) || undefined,
    expiringWithinDays:
      expiringParam && !Number.isNaN(Number(expiringParam)) ? Number(expiringParam) : undefined,
    batchReady: firstValue(params.batchReady) === '1' || firstValue(params.batchReady) === 'true',
    q: firstValue(params.q) || undefined,
    page: pageParam && !Number.isNaN(Number(pageParam)) ? Math.max(1, Number(pageParam)) : 1,
    pageSize: 50,
  }
}

export default async function AllVouchersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const canManage = await checkUserPermission('vouchers', 'manage')
  if (!canManage) redirect('/unauthorized')

  const params = await searchParams
  const filters = parseLedgerFilters(params)

  const [ledgerResult, typesResult, batchesResult] = await Promise.all([
    getVoucherLedger(filters),
    listVoucherTypes(),
    listVoucherBatches(),
  ])

  if (ledgerResult.error || !ledgerResult.data) {
    return (
      <PageLayout title="All vouchers" navItems={VOUCHER_SECTION_NAV}>
        <Alert tone="danger" title="Could not load the ledger">
          {ledgerResult.error ?? 'Something went wrong. Refresh to try again.'}
        </Alert>
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="All vouchers"
      subtitle="The full voucher ledger with filters, bulk actions and CSV export"
      navItems={VOUCHER_SECTION_NAV}
    >
      <LedgerClient
        initialFilters={filters}
        initialResult={ledgerResult.data}
        types={(typesResult.data ?? []).map((type) => ({
          id: type.id,
          displayTitle: type.displayTitle,
        }))}
        batches={(batchesResult.data ?? []).map((batch) => ({
          id: batch.id,
          label: `${batch.createdAt.slice(0, 10)} · ${batch.totalCount} cards${
            batch.note ? ` · ${batch.note}` : ''
          }`,
        }))}
      />
    </PageLayout>
  )
}
