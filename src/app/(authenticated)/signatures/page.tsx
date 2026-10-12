import { redirect } from 'next/navigation'
import { Alert, Badge, Card, CardBody, CardHeader, Empty, LinkButton, PageLayout } from '@/ds'
import { getSigningOverview, type SigningOverviewFilter } from '@/app/actions/signing'
import {
  SIGNING_DOCUMENT_STATUS_LABEL,
  SIGNING_DOCUMENT_STATUS_TONE,
} from '@/components/features/signing/status-ui'
import { formatDateInLondon } from '@/lib/dateUtils'
import { getSigningKind } from '@/lib/signing/kinds'

export const dynamic = 'force-dynamic'

type PageProps = { searchParams: Promise<{ show?: string }> }

const FILTERS: Array<{ value: SigningOverviewFilter; label: string; empty: string }> = [
  { value: 'outstanding', label: 'Waiting', empty: 'Nothing is waiting to be signed.' },
  { value: 'signed', label: 'Signed', empty: 'Nothing has been signed yet.' },
  { value: 'closed', label: 'Declined, Withdrawn or Expired', empty: 'Nothing has been declined, withdrawn or expired.' },
]

function day(iso: string): string {
  return formatDateInLondon(iso, { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Every document sent for signature, in one place: what we are waiting on, what has been signed
 * and what fell through. Sending happens on each record; this page is for seeing it all.
 */
export default async function SignaturesPage({ searchParams }: PageProps): Promise<React.JSX.Element> {
  const { show } = await searchParams
  const filter = FILTERS.find((option) => option.value === show) ?? FILTERS[0]
  const result = await getSigningOverview(filter.value)
  if (result.error === 'Unauthorized' || result.error === 'Insufficient permissions') redirect('/unauthorized')
  const rows = result.data?.rows ?? []

  return (
    <PageLayout
      title="Signatures"
      subtitle="Documents sent for signature"
      navItems={FILTERS.map((option) => ({
        label: option.label,
        href: `/signatures?show=${option.value}`,
        // The tab row matches on the path alone, and these differ only by query.
        active: option.value === filter.value,
      }))}
    >
      <div className="space-y-6">
        {result.error ? <Alert tone="danger" title="The documents could not be loaded">{result.error}</Alert> : null}
        {result.data?.truncated ? (
          <Alert tone="info">Showing the most recent 100. Older documents are on the record they belong to.</Alert>
        ) : null}

        <Card>
          <CardHeader title={filter.label} />
          <CardBody>
            {rows.length === 0 && !result.error ? (
              <Empty title={filter.empty} size="sm" />
            ) : (
              <ul className="divide-y divide-border">
                {rows.map(({ document, subjectLabel, subjectPath }) => {
                  const waitingOn = document.parties.filter((party) => party.status === 'pending').map((party) => party.name)
                  return (
                    <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0 break-words">
                        <p className="font-medium text-text-strong">{document.title}</p>
                        <p className="text-xs text-text-muted">
                          {getSigningKind(document.kind).label} for {subjectLabel}. Sent {day(document.sent_at)}
                          {document.status === 'completed' && document.completed_at ? `, signed ${day(document.completed_at)}` : ''}
                          {waitingOn.length > 0 && (document.status === 'sent' || document.status === 'part_signed')
                            ? `. Waiting on ${waitingOn.join(', ')} until ${day(document.expires_at)}`
                            : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={SIGNING_DOCUMENT_STATUS_TONE[document.status]}>
                          {SIGNING_DOCUMENT_STATUS_LABEL[document.status]}
                        </Badge>
                        <LinkButton href={subjectPath} size="sm" variant="secondary">
                          Open Record
                          <span className="sr-only">: {subjectLabel}</span>
                        </LinkButton>
                        <LinkButton href={`/api/signing/documents/${document.id}/pdf`} size="sm" variant="ghost" download>
                          Download
                          <span className="sr-only">: {document.title} for {subjectLabel}</span>
                        </LinkButton>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </PageLayout>
  )
}
