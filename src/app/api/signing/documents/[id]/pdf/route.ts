import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { SigningError, downloadSigningPdf, getSigningDocument } from '@/lib/signing/service'
import { canViewSigningKind, getSigningStaffUser } from '@/lib/signing/staff'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A signed document whose finishing step did not run is finished here, which starts a browser.
export const maxDuration = 60

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Staff download of a signing document: the signed copy with its signing record once everyone
 * has signed, otherwise the document as it was sent. Session and permission checked here,
 * because /api is public at the middleware level.
 */
export async function GET(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) {
    return new NextResponse('Document not found', { status: 404 })
  }

  const user = await getSigningStaffUser()
  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  try {
    const document = await getSigningDocument(id)
    if (!document) {
      return new NextResponse('Document not found', { status: 404 })
    }
    if (!(await canViewSigningKind(document.kind, user.id))) {
      return new NextResponse('Permission denied', { status: 403 })
    }

    const { buffer, fileName } = await downloadSigningPdf({ documentId: id, userId: user.id })
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'private, no-store, max-age=0',
      },
    })
  } catch (error) {
    if (error instanceof SigningError && error.code === 'not_found') {
      return new NextResponse('Document not found', { status: 404 })
    }
    logger.error('Signing document download failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { documentId: id },
    })
    return new NextResponse('The document could not be prepared. Please try again.', { status: 500 })
  }
}
