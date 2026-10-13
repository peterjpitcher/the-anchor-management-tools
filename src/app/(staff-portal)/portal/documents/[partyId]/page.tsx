import { notFound } from 'next/navigation'
import { StandalonePageHeader } from '@/components/shells/StandaloneShell'
import { SigningStaffView } from '@/components/features/signing/SigningStaffView'
import { getPortalPartyContext, getPortalWorker } from '@/lib/signing/portal'
import { getSigningDocument, listOtherDocumentsToSign, resolveSigningPartyState, withdrawIfSubjectClosed } from '@/lib/signing/service'
import { buildSigningViewModel } from '@/lib/signing/view-model'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ partyId: string }> }

/**
 * A worker signing one of their own documents while signed in. The same screen as the emailed
 * link, minus the date of birth question: signing in is the identity check here.
 */
export default async function PortalSignPage({ params }: PageProps): Promise<React.JSX.Element> {
  const { partyId } = await params
  const worker = await getPortalWorker()
  if (!worker) notFound()
  const found = await getPortalPartyContext(worker, partyId)
  if (!found) notFound()
  const context = await withdrawIfSubjectClosed(found)

  const [document, alsoToSign] = await Promise.all([
    getSigningDocument(context.document.id),
    listOtherDocumentsToSign(context),
  ])
  const model = buildSigningViewModel({
    context,
    state: resolveSigningPartyState(context, 'portal'),
    otherParties: document?.parties ?? [],
    alsoToSign,
    endpoints: {
      document: `/api/portal/signing/${partyId}/document`,
      sign: `/api/portal/signing/${partyId}/sign`,
      decline: `/api/portal/signing/${partyId}/decline`,
    },
  })

  return (
    <>
      <StandalonePageHeader
        title={model.title}
        subtitle={model.mode === 'acknowledge' ? 'Read it, then confirm' : 'Read it, then sign'}
        backButton={{ label: 'Back to My Documents', href: '/portal/documents' }}
      />
      <SigningStaffView model={model} />
    </>
  )
}
