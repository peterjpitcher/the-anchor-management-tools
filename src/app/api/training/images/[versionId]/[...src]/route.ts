import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getPortalWorker } from '@/lib/portal/worker'
import { trainingObjectResponse } from '@/lib/training/storage'
import { TrainingError } from '@/lib/training/types'
import { TrainingService } from '@/services/training'
import { getSessionUserId, getTrainingStaffAccess, isUuid } from '../../../access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ versionId: string; src: string[] }> }

/** The longest image path a course file may use; anything longer is not one of ours. */
const MAX_SRC_LENGTH = 300

/**
 * One image of a course version (build contract 5.5), for the player and the preview.
 *
 * Who may see it: a signed-in user holding `training:publish` (any version, drafts included,
 * for the preview); one holding `training:view` (published versions); or a portal worker with a
 * cycle on that course (published versions only). Only an image listed on the version is
 * served, by its exact `src`, so the path in the URL can never reach another object. Streamed
 * from the private `training` bucket with `Cache-Control: private`.
 */
export async function GET(_request: NextRequest, context: RouteContext): Promise<Response> {
  const { versionId, src: segments } = await context.params
  const src = (segments ?? []).join('/')
  if (!isUuid(versionId) || !src || src.length > MAX_SRC_LENGTH || src.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    return new NextResponse('Image not found', { status: 404 })
  }

  try {
    const userId = await getSessionUserId()
    if (!userId) return new NextResponse('Unauthorized', { status: 401 })

    const access = await getTrainingStaffAccess(userId)
    let publishedOnly = true
    if (access.canPublish) {
      publishedOnly = false
    } else if (!access.canView) {
      const worker = await getPortalWorker()
      if (!worker || !(await TrainingService.employeeCanSeeVersion(worker.employeeId, versionId))) {
        return new NextResponse('Permission denied', { status: 403 })
      }
    }

    const version = await TrainingService.getVersion(versionId)
    if (!version || (publishedOnly && version.state !== 'published')) {
      return new NextResponse('Image not found', { status: 404 })
    }
    const image = version.images.find((candidate) => candidate.src === src)
    if (!image) return new NextResponse('Image not found', { status: 404 })

    return await trainingObjectResponse(image.path, {
      disposition: 'inline',
      cache: 'private',
      fileName: src.split('/').pop() ?? 'image',
    })
  } catch (error) {
    if (error instanceof TrainingError && error.code === 'not_found') {
      return new NextResponse('Image not found', { status: 404 })
    }
    logger.error('Training image could not be served', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { versionId },
    })
    return new NextResponse('The image could not be loaded. Please try again.', { status: 500 })
  }
}
