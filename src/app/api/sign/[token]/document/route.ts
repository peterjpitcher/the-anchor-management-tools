import { NextRequest, NextResponse } from 'next/server'
import {
  linkNotValid,
  messageForState,
  openPublicSigningRequest,
  signingError,
  signingServerError,
} from '@/lib/signing/public-request'
import { viewSigningDocument } from '@/lib/signing/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ token: string }> }

/**
 * The exact PDF sent for signature, shown in the browser. Serving it is what records that the
 * signer opened the document, which the agree button depends on.
 */
export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { token } = await context.params
  try {
    const opened = await openPublicSigningRequest(request, token, { scope: 'signing-document', maxAttempts: 30 })
    if ('response' in opened) return opened.response
    const { context: signing, state, evidence } = opened.request

    // Only while there is something to sign. Once signed, the link is spent: the signed copy
    // goes by email, and a link left in a browser history or a forwarded email shows nothing.
    if (state === 'signed') {
      return signingError('NOT_AVAILABLE', 'You have signed this document. Your copy is sent to you by email.', 410)
    }
    if (state !== 'ready' && state !== 'needs_identity_check') {
      return signingError('NOT_AVAILABLE', messageForState(state) ?? 'This document is not available.', 410)
    }
    if (state === 'needs_identity_check') {
      return signingError('NOT_AVAILABLE', 'Please confirm your date of birth before opening the document.', 403)
    }

    const pdf = await viewSigningDocument(signing, evidence)
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="document.pdf"',
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'SigningError' && (error as { code?: string }).code === 'not_found') {
      return linkNotValid()
    }
    return signingServerError('document', error)
  }
}
