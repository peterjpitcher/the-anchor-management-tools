import { NextRequest, NextResponse } from 'next/server'
import { openPortalSigningRequest } from '@/lib/signing/portal-request'
import { signingError, signingServerError } from '@/lib/signing/public-request'
import { downloadSigningPdf } from '@/lib/signing/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type RouteContext = { params: Promise<{ partyId: string }> }

/** A worker's own copy of a document they signed, once everyone has signed it. */
export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { partyId } = await context.params
  try {
    const opened = await openPortalSigningRequest(request, partyId)
    if ('response' in opened) return opened.response
    const { worker, context: signing } = opened.request
    const status = signing.document.status
    if (signing.party.status !== 'signed' || (status !== 'completed' && status !== 'superseded')) {
      return signingError('NOT_AVAILABLE', 'Your copy is ready once everyone has signed.', 409)
    }

    const { buffer, fileName } = await downloadSigningPdf({ documentId: signing.document.id, userId: worker.userId })
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'private, no-store, max-age=0',
      },
    })
  } catch (error) {
    return signingServerError('portal signed copy', error, { partyId })
  }
}
