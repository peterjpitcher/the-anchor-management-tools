import { Alert, Badge, Card, CardBody, CardHeader, Empty, LinkButton } from '@/ds'
import { StandalonePageHeader } from '@/components/shells/StandaloneShell'
import { SIGNING_PARTY_STATUS_LABEL, SIGNING_PARTY_STATUS_TONE } from '@/components/features/signing/status-ui'
import { formatDateInLondon } from '@/lib/dateUtils'
import { getPortalWorker, listPortalSigningItems, type PortalSigningItem } from '@/lib/signing/portal'
import { SIGNING_OPEN_STATUSES } from '@/lib/signing/types'

export const dynamic = 'force-dynamic'

function day(iso: string): string {
  return formatDateInLondon(iso, { day: 'numeric', month: 'short', year: 'numeric' })
}

function isWaiting(item: PortalSigningItem): boolean {
  return (
    item.party.status === 'pending' &&
    SIGNING_OPEN_STATUSES.includes(item.document.status) &&
    new Date(item.document.expires_at).getTime() > Date.now()
  )
}

export default async function MyDocumentsPage(): Promise<React.JSX.Element> {
  const worker = await getPortalWorker()
  if (!worker) {
    return (
      <>
        <StandalonePageHeader title="My Documents" subtitle="Documents to read and sign" />
        <Alert tone="warning">Your account is not linked to an employee profile. Please contact your manager.</Alert>
      </>
    )
  }

  let items: PortalSigningItem[] = []
  let loadError: string | null = null
  try {
    items = await listPortalSigningItems(worker.employeeId)
  } catch {
    // Never shown as "you have nothing to sign": that would be a wrong answer.
    loadError = 'Your documents could not be loaded. Please try again in a moment.'
  }
  const waiting = items.filter(isWaiting)
  const done = items.filter((item) => item.party.status === 'signed')

  return (
    <>
      <StandalonePageHeader title="My Documents" subtitle="Documents to read and sign" />
      {loadError ? <Alert tone="danger">{loadError}</Alert> : null}

      <Card>
        <CardHeader title="Waiting for you" />
        <CardBody>
          {waiting.length === 0 ? (
            <Empty title={loadError ? 'Not loaded' : 'Nothing to sign'} description={loadError ? undefined : 'You are up to date.'} size="sm" />
          ) : (
            <ul className="divide-y divide-border">
              {waiting.map((item) => (
                <li key={item.party.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="font-medium text-text-strong">{item.document.title}</p>
                    <p className="text-xs text-text-muted">
                      Sent {day(item.document.sent_at)}. Please respond by {day(item.document.expires_at)}
                    </p>
                  </div>
                  <LinkButton href={`/portal/documents/${item.party.id}`} variant="primary" size="sm">
                    {item.document.mode === 'acknowledge' ? 'Read and confirm' : 'Read and sign'}
                  </LinkButton>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {done.length > 0 ? (
        <Card>
          <CardHeader title="Signed" />
          <CardBody>
            <ul className="divide-y divide-border">
              {done.map((item) => (
                <li key={item.party.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="font-medium text-text-strong">{item.document.title}</p>
                    <p className="text-xs text-text-muted">
                      {item.party.signed_at ? `You signed on ${day(item.party.signed_at)}` : 'Signed'}
                      {item.document.status === 'part_signed' ? '. Waiting for the other signer' : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={SIGNING_PARTY_STATUS_TONE[item.party.status]}>{SIGNING_PARTY_STATUS_LABEL[item.party.status]}</Badge>
                    {item.document.status === 'completed' || item.document.status === 'superseded' ? (
                      <LinkButton href={`/api/portal/signing/${item.party.id}/signed`} variant="secondary" size="sm" download>
                        Download my copy
                      </LinkButton>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </>
  )
}
