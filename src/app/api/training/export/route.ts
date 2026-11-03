import { NextRequest, NextResponse } from 'next/server'
import { logAuditEvent } from '@/app/actions/audit'
import { toLocalIsoDate } from '@/lib/dateUtils'
import { logger } from '@/lib/logger'
import { TrainingService } from '@/services/training'
import { getSessionUserId, getTrainingStaffAccess, isUuid } from '../access'
import { buildTrainingLogCsv } from './csv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Downloads the training log as a CSV (build contract 5.5), for a signed-in user holding
 * `training:view`. `?employeeId=<uuid>` limits it to one person. Every export is audited.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const employeeParam = request.nextUrl.searchParams.get('employeeId')
  if (employeeParam !== null && !isUuid(employeeParam)) {
    return NextResponse.json({ error: 'Unknown employee' }, { status: 400 })
  }

  try {
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const access = await getTrainingStaffAccess(userId)
    if (!access.canView) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const items = await TrainingService.listActivityForExport(employeeParam ? { employeeId: employeeParam } : {})
    const now = new Date()
    const personName = employeeParam ? items.find((item) => item.employeeName)?.employeeName ?? null : null
    const csv = buildTrainingLogCsv(items, now, { personName })

    await logAuditEvent({
      user_id: userId,
      operation_type: 'export',
      resource_type: 'training_log',
      ...(employeeParam ? { resource_id: employeeParam } : {}),
      operation_status: 'success',
      additional_info: { rows: items.length, scope: employeeParam ? 'employee' : 'all' },
    })

    const fileName = `training-log-${toLocalIsoDate(now)}.csv`
    return new NextResponse(new Uint8Array(csv), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    logger.error('Training log export failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { employeeId: employeeParam },
    })
    return NextResponse.json({ error: 'The training log could not be exported. Please try again.' }, { status: 500 })
  }
}
