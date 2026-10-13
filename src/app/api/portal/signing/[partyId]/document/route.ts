import { NextRequest, NextResponse } from 'next/server'
import { openPortalSigningRequest, portalStateRefusal } from '@/lib/signing/portal-request'
import { signingServerError } from '@/lib/signing/public-request'
import { viewSigningDocument } from '@/lib/signing/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ partyId: string }> }

/** The document as sent, for a signed-in worker. Serving it records that they opened it. */
export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { partyId } = await context.params
  try {
    const opened = await openPortalSigningRequest(request, partyId)
    if ('response' in opened) return opened.response
    const { context: signing, state, evidence } = opened.request
    // A signed-in worker may re-read their own document after signing it.
    if (state !== 'ready' && state !== 'signed') return portalStateRefusal(state)

    const pdf = await viewSigningDocument(signing, evidence)
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="document.pdf"',
        'Cache-Control': 'private, no-store, max-age=0',
      },
    })
  } catch (error) {
    return signingServerError('portal document', error, { partyId })
  }
}
