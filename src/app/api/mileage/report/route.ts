/**
 * GET /api/mileage/report?from=YYYY-MM-DD&to=YYYY-MM-DD&driver=all|<driver id> (spec 6.4, 7.2 and 7.3).
 * The permission check runs before any query. Every failure returns { code, error }, so nothing is
 * downloaded. The audit event records that a report was generated or failed; it never claims the
 * browser saved the file. Logs carry codes and messages, never report contents or names.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { describePeriod } from '@/lib/mileage/periods'
import { loadMileageReportDataset, validateReportRange } from '@/lib/mileage/report/dataset'
import {
  MILEAGE_REPORT_ERROR_MESSAGES,
  MILEAGE_REPORT_ERROR_STATUS,
  MileageReportError,
  type MileageReportErrorCode,
} from '@/lib/mileage/report/errors'
import { buildMileageReport } from '@/lib/mileage/report/model'
import { mileageReportFileName, renderMileageReportPdf } from '@/lib/mileage/report/pdf'

export const runtime = 'nodejs'
export const maxDuration = 60

type ReportStage = 'permission' | 'validate' | 'query' | 'build' | 'render'

const ALLOWED_PARAMS = new Set(['from', 'to', 'driver'])
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' }

const paramsSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  driver: z.union([z.literal('all'), z.string().uuid()]),
})

function errorResponse(code: MileageReportErrorCode, message: string = MILEAGE_REPORT_ERROR_MESSAGES[code]): NextResponse {
  return NextResponse.json({ code, error: message }, { status: MILEAGE_REPORT_ERROR_STATUS[code], headers: PRIVATE_HEADERS })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function GET(request: Request): Promise<NextResponse> {
  const startedAt = Date.now()

  // The session lookup can throw (for example when auth is unreachable). It still gets a coded,
  // private response rather than an uncaught 500.
  let user: { id: string; email?: string } | null
  try {
    const authClient = await createClient()
    const { data } = await authClient.auth.getUser()
    user = data.user
  } catch (authError) {
    console.error('[mileage] report sign-in check failed', { message: errorMessage(authError) })
    return errorResponse('MILEAGE_REPORT_QUERY_FAILED')
  }
  if (!user) return errorResponse('MILEAGE_FORBIDDEN')

  const userId = user.id
  const userEmail = user.email ?? undefined
  let stage: ReportStage = 'permission'
  const scope: { from: string | null; to: string | null; driver: string | null; tripCount: number | null } = {
    from: null,
    to: null,
    driver: null,
    tripCount: null,
  }

  const record = async (status: 'success' | 'failure', errorCode?: MileageReportErrorCode): Promise<void> => {
    try {
      await logAuditEvent({
        user_id: userId,
        user_email: userEmail,
        operation_type: 'export',
        resource_type: 'mileage_report',
        operation_status: status,
        error_message: errorCode,
        additional_info: {
          from: scope.from,
          to: scope.to,
          driver_scope: scope.driver,
          trip_count: scope.tripCount,
          duration_ms: Date.now() - startedAt,
          failed_stage: status === 'failure' ? stage : null,
          delivery_confirmed: false,
        },
      })
    } catch (auditError) {
      console.error('[mileage] report audit write failed', { message: errorMessage(auditError) })
    }
  }

  try {
    if (!(await checkUserPermission('mileage', 'view', userId))) {
      await record('failure', 'MILEAGE_FORBIDDEN')
      return errorResponse('MILEAGE_FORBIDDEN')
    }

    stage = 'validate'
    const searchParams = new URL(request.url).searchParams
    const keys = [...searchParams.keys()]
    const parsed = paramsSchema.safeParse(Object.fromEntries(searchParams))
    if (!parsed.success || keys.some((key) => !ALLOWED_PARAMS.has(key)) || new Set(keys).size !== keys.length) {
      await record('failure', 'MILEAGE_REPORT_INVALID_RANGE')
      return errorResponse('MILEAGE_REPORT_INVALID_RANGE', 'Choose the dates and driver for the report.')
    }
    const { from, to, driver } = parsed.data
    scope.from = from
    scope.to = to
    scope.driver = driver
    validateReportRange(from, to)

    stage = 'query'
    const dataset = await loadMileageReportDataset(createAdminClient(), { from, to })

    stage = 'build'
    const period = describePeriod(from, to)
    const model = buildMileageReport(dataset, { period, driverId: driver === 'all' ? null : driver })
    scope.tripCount = model.totals.trips

    stage = 'render'
    const pdf = await renderMileageReportPdf(model)

    await record('success')
    return new NextResponse(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${mileageReportFileName(period, model.scope.driverName)}"`,
        'Content-Length': String(pdf.length),
      },
    })
  } catch (error) {
    const code: MileageReportErrorCode =
      error instanceof MileageReportError
        ? error.code
        : stage === 'render'
          ? 'MILEAGE_REPORT_RENDER_FAILED'
          : 'MILEAGE_REPORT_QUERY_FAILED'
    console.error('[mileage] report failed', { code, stage, message: errorMessage(error) })
    await record('failure', code)
    return errorResponse(code, error instanceof MileageReportError ? error.message : undefined)
  }
}
