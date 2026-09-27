import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getTermsVersions, listVoucherTypes } from '@/app/actions/vouchers'
import { PageLayout, Card, CardBody, CardHeader, Badge, Alert, Empty, LinkButton, Section } from '@/ds'
import { formatDateInLondon } from '@/lib/dateUtils'
import { formatPence } from '../_shared/voucher-ui'
import { VOUCHERS_NAV } from '../_shared/nav'

export const dynamic = 'force-dynamic'

export default async function VoucherTypesPage() {
  const canManage = await checkUserPermission('vouchers', 'manage')
  if (!canManage) redirect('/unauthorized')

  const [typesResult, termsResult] = await Promise.all([listVoucherTypes(), getTermsVersions()])

  // A top-level tab: no back button.
  const layoutProps = {
    title: 'Vouchers',
    subtitle: 'Types & Terms: voucher types and terms, a read-only reference',
    navItems: VOUCHERS_NAV,
  }

  if (typesResult.error || termsResult.error) {
    return (
      <PageLayout {...layoutProps}>
        <Alert tone="danger" title="Could not load the reference data">
          {typesResult.error ?? termsResult.error ?? 'Something went wrong. Refresh to try again.'}
        </Alert>
      </PageLayout>
    )
  }

  const types = typesResult.data ?? []
  const termsVersions = termsResult.data ?? []

  return (
    <PageLayout {...layoutProps}>
      <p className="text-sm text-text-muted">
        Types and terms change by migration only; each card keeps the definition it was printed
        with.
      </p>

      <Section title="Voucher Types">
        {types.length === 0 ? (
          <Card>
            <Empty
              size="sm"
              title="No voucher types yet"
              description="The seed migration has not been applied."
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {types.map((type) => (
              <Card key={type.id}>
                <CardHeader
                  title={type.displayTitle}
                  subtitle={type.id}
                  action={
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {type.valuePence !== null && (
                        <Badge tone="neutral">{formatPence(type.valuePence)}</Badge>
                      )}
                      {type.alcohol && <Badge tone="warning">18+ alcohol</Badge>}
                      {type.requiresBooking && <Badge tone="info">Booking required</Badge>}
                      {!type.active && <Badge tone="neutral">Inactive</Badge>}
                    </div>
                  }
                />
                <CardBody>
                  <div
                    className="text-sm text-text [&_p]:mb-2 [&_strong]:font-semibold"
                    dangerouslySetInnerHTML={{ __html: type.entitlementHtml }}
                  />
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {termsVersions.map((version) => (
        <Card key={version.version}>
          <CardHeader
            title={`Terms ${version.version}`}
            subtitle={`Effective from ${formatDateInLondon(version.effectiveFrom, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}`}
            action={
              <LinkButton
                href={`/api/vouchers/terms-sheet?version=${encodeURIComponent(version.version)}`}
                target="_blank"
                variant="secondary"
                size="sm"
              >
                Print Terms Sheet
              </LinkButton>
            }
          />
          <CardBody>
            <ol className="list-decimal space-y-2 pl-6">
              {version.clauses.map((clause, index) => (
                <li key={`${version.version}-${index}`} className="text-sm">
                  <span className="font-medium text-text">{clause.heading}</span>
                  <span className="text-text"> {clause.body}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      ))}
      {termsVersions.length === 0 && (
        <Alert tone="warning" title="No terms versions found">
          The terms seed migration has not been applied yet.
        </Alert>
      )}
    </PageLayout>
  )
}
