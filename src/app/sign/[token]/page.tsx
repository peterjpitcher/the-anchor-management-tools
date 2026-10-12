import { headers } from 'next/headers'
import { GuestIntro, GuestShell } from '@/components/features/guest'
import { SigningGuestView } from '@/components/features/guest/signing/SigningGuestView'
import { SigningStaffView } from '@/components/features/signing/SigningStaffView'
import { StandalonePageHeader, StandaloneShell } from '@/components/shells/StandaloneShell'
import { Alert } from '@/ds'
import { readSigningEvidence } from '@/lib/signing/evidence'
import {
  getSigningDocument,
  getSigningPartyByToken,
  recordSigningOpened,
  resolveSigningPartyState,
} from '@/lib/signing/service'
import { buildSigningViewModel } from '@/lib/signing/view-model'
import { isKnownBotUserAgent } from '@/lib/user-agent-parser'

// Static and non-personal on purpose, like every public token page: no token, name or document
// title may reach a browser title or history entry.
export const metadata = { title: 'Sign a document', robots: { index: false, follow: false } }

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ token: string }> }

/**
 * The page behind a signing link. Anyone holding the link can reach it, so it shows only what
 * that one signer needs: the document's title, who sent it, and the form. An unknown link and a
 * malformed one get the same neutral screen, with no hint as to which it was.
 */
export default async function SignPage({ params }: PageProps): Promise<React.JSX.Element> {
  const { token } = await params
  const context = await getSigningPartyByToken(token)

  if (!context) {
    // We cannot tell whose brand to show, so this uses the plain staff frame.
    return (
      <StandaloneShell label="Document signing">
        <StandalonePageHeader title="This link is not valid" />
        <Alert tone="warning">
          Please use the link in your most recent email. If it still does not work, reply to that email and we will
          send you a new one.
        </Alert>
      </StandaloneShell>
    )
  }

  const requestHeaders = await headers()
  // Mail scanners and link previews follow links too. They are not the signer opening it.
  if (!isKnownBotUserAgent(requestHeaders.get('user-agent'))) {
    try {
      await recordSigningOpened(context, readSigningEvidence(requestHeaders))
    } catch {
      // Not being able to note the opening must not stop someone reading their document.
    }
  }

  const document = await getSigningDocument(context.document.id)
  const model = buildSigningViewModel({
    context,
    state: resolveSigningPartyState(context, 'link'),
    otherParties: document?.parties ?? [],
    endpoints: {
      document: `/api/sign/${token}/document`,
      identity: `/api/sign/${token}/identity`,
      sign: `/api/sign/${token}/sign`,
      decline: `/api/sign/${token}/decline`,
    },
  })
  const lead = `Hi ${model.recipientName.split(/\s+/)[0]}, ${model.senderName} has sent you this to ${model.mode === 'acknowledge' ? 'read and confirm' : 'read and sign'}.`

  if (model.brand === 'guest') {
    return (
      <GuestShell>
        <GuestIntro kicker="Document signing" title={model.title} lead={lead} />
        <SigningGuestView model={model} />
      </GuestShell>
    )
  }

  return (
    <StandaloneShell label="Document signing">
      <StandalonePageHeader title={model.title} subtitle={lead} />
      <SigningStaffView model={model} />
    </StandaloneShell>
  )
}
