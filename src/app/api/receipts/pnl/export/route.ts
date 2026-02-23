import { NextRequest, NextResponse } from 'next/server'

import { logAuditEvent } from '@/app/actions/audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { getCurrentUser } from '@/lib/audit-helpers'
import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { buildPnlReportViewModel } from '@/lib/pnl/report-view-model'
import { generatePnlReportHTML } from '@/lib/pnl/report-template'
import { pnlExportSchema } from '@/lib/validation'
import { FinancialService } from '@/services/financials'

export const runtime = 'nodejs'
export const maxDuration = 120

const EXPORT_FAILURE_MESSAGE = 'Failed to generate P&L report export.'
const INVALID_TIMEFRAME_MESSAGE = 'Invalid timeframe parameter.'

async function logExportAudit(timeframe: '1m' | '3m' | '12m') {
  try {
    const userInfo = await getCurrentUser()

    await logAuditEvent({
      ...(userInfo.user_id && { user_id: userInfo.user_id }),
      ...(userInfo.user_email && { user_email: userInfo.user_email }),
      operation_type: 'export',
      resource_type: 'receipts',
      operation_status: 'success',
      additional_info: {
        report: 'pnl',
        timeframe,
      },
    })
  } catch (error) {
    console.warn('Failed to write receipts P&L export audit log:', error)
  }
}

function buildFilename(timeframe: '1m' | '3m' | '12m', now: Date) {
  return `pnl-shadow-report-${timeframe}-${now.toISOString().slice(0, 10)}.pdf`
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const canExport = await checkUserPermission('receipts', 'export')

    if (!canExport) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    const timeframeRaw = url.searchParams.get('timeframe') ?? undefined
    const parsed = pnlExportSchema.safeParse({ timeframe: timeframeRaw })

    if (!parsed.success) {
      return NextResponse.json({ error: INVALID_TIMEFRAME_MESSAGE }, { status: 400 })
    }

    const now = new Date()
    const dashboardData = await FinancialService.getPlDashboardData()
    const viewModel = buildPnlReportViewModel(dashboardData, parsed.data.timeframe, now)

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || url.origin
    const logoUrl = `${appUrl}/logo-oj.jpg`

    const html = generatePnlReportHTML(viewModel, { logoUrl })
    const pdfBuffer = await generatePDFFromHTML(html, {
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: false,
      margin: {
        top: '8mm',
        right: '8mm',
        bottom: '8mm',
        left: '8mm',
      },
    })

    await logExportAudit(parsed.data.timeframe)

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${buildFilename(parsed.data.timeframe, now)}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Receipts P&L export failed:', error)
    return NextResponse.json({ error: EXPORT_FAILURE_MESSAGE }, { status: 500 })
  }
}
