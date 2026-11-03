import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { trainingObjectResponse } from '@/lib/training/storage'
import { TrainingError } from '@/lib/training/types'
import { TrainingService } from '@/services/training'
import { getSessionUserId, getTrainingStaffAccess, isUuid } from '../../access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ assignmentId: string }> }

/**
 * The stored certificate of an external qualification (build contract 5.5), for a signed-in
 * user holding `training:view`. Streamed from the private `training` bucket as a download, never
 * cached.
 */
export async function GET(_request: NextRequest, context: RouteContext): Promise<Response> {
  const { assignmentId } = await context.params
  if (!isUuid(assignmentId)) {
    return new NextResponse('Certificate not found', { status: 404 })
  }

  try {
    const userId = await getSessionUserId()
    if (!userId) return new NextResponse('Unauthorized', { status: 401 })
    const access = await getTrainingStaffAccess(userId)
    if (!access.canView) return new NextResponse('Permission denied', { status: 403 })

    const assignment = await TrainingService.getAssignment(assignmentId)
    if (!assignment || !assignment.externalFilePath) {
      return new NextResponse('Certificate not found', { status: 404 })
    }

    const extension = assignment.externalFilePath.split('.').pop()?.toLowerCase() ?? 'pdf'
    const safeExtension = /^[a-z0-9]{1,5}$/.test(extension) ? extension : 'pdf'
    return await trainingObjectResponse(assignment.externalFilePath, {
      disposition: 'attachment',
      cache: 'no-store',
      fileName: `certificate.${safeExtension}`,
    })
  } catch (error) {
    if (error instanceof TrainingError && error.code === 'not_found') {
      return new NextResponse('Certificate not found', { status: 404 })
    }
    logger.error('External training certificate could not be served', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { assignmentId },
    })
    return new NextResponse('The certificate could not be loaded. Please try again.', { status: 500 })
  }
}
