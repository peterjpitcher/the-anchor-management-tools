import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getTermsVersions, listVoucherTypes } from '@/app/actions/vouchers'
import { PageLayout, Card, Badge, Alert, LinkButton } from '@/ds'
import { formatDateInLondon } from '@/lib/dateUtils'
import { formatPence, VOUCHER_SECTION_NAV } from '../_shared/voucher-ui'

export const dynamic = 'force-dynamic'

export default async function VoucherTypesPage() {
  const canManage = await checkUserPermission('vouchers', 'manage')
  if (!canManage) redirect('/unauthorized')

  const [typesResult, termsResult] = await Promise.all([listVoucherTypes(), getTermsVersions()])

  if (typesResult.error || termsResult.error) {
    return (
      <PageLayout title="Types & terms" navItems={VOUCHER_SECTION_NAV}>
        <Alert tone="danger" title="Could not load the reference data">
          {typesResult.error ?? termsResult.error ?? 'Something went wrong. Refresh to try again.'}
        </Alert>
      </PageLayout>
    )
  }

  const types = typesResult.data ?? []
  const termsVersions = termsResult.data ?? []

  return (
    <PageLayout
      title="Types & terms"
      subtitle="Read-only reference. Types and terms change by migration only; each card keeps the definition it was printed with."
      navItems={VOUCHER_SECTION_NAV}
      backButton={{ label: 'Back to vouchers', href: '/vouchers' }}
    >
      <div className="space-y-6">
        <Card title="Voucher types">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {types.map((type) => (
              <div key={type.id} className="rounded-lg border border-gray-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-gray-900">{type.displayTitle}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {type.valuePence !== null && (
                      <Badge tone="neutral">{formatPence(type.valuePence)}</Badge>
                    )}
                    {type.alcohol && <Badge tone="warning">18+ alcohol</Badge>}
                    {type.requiresBooking && <Badge tone="info">Booking required</Badge>}
                    {!type.active && <Badge tone="danger">Inactive</Badge>}
                  </div>
                </div>
                <div className="mt-1 text-xs uppercase tracking-wide text-gray-400">
                  {type.id}
                </div>
                <div
                  className="mt-3 text-sm text-gray-700 [&_p]:mb-2 [&_strong]:font-semibold"
                  dangerouslySetInnerHTML={{ __html: type.entitlementHtml }}
                />
              </div>
            ))}
            {types.length === 0 && (
              <p className="text-sm text-gray-500">
                No voucher types found. The seed migration has not been applied.
              </p>
            )}
          </div>
        </Card>

        {termsVersions.map((version) => (
          <Card
            key={version.version}
            header={
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">
                    Terms {version.version}
                  </h3>
                  <p className="text-sm text-gray-500">
                    Effective from{' '}
                    {formatDateInLondon(version.effectiveFrom, {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                </div>
                <LinkButton
                  href={`/api/vouchers/terms-sheet?version=${encodeURIComponent(version.version)}`}
                  target="_blank"
                  variant="secondary"
                >
                  Print terms sheet
                </LinkButton>
              </div>
            }
          >
            <ol className="list-decimal space-y-2 pl-6">
              {version.clauses.map((clause, index) => (
                <li key={`${version.version}-${index}`} className="text-sm">
                  <span className="font-medium text-gray-900">{clause.heading}</span>
                  <span className="text-gray-700"> {clause.body}</span>
                </li>
              ))}
            </ol>
          </Card>
        ))}
        {termsVersions.length === 0 && (
          <Alert tone="warning" title="No terms versions found">
            The terms seed migration has not been applied yet.
          </Alert>
        )}
      </div>
    </PageLayout>
  )
}
