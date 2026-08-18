import { NextRequest, NextResponse } from 'next/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { getWorkRecord } from '@/app/actions/oj-projects/work-record'
import { generateWorkRecordPDF } from '@/lib/oj-work-record'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { searchParams } = request.nextUrl
  const vendorId = searchParams.get('vendorId')
  const dateFrom = searchParams.get('dateFrom')
  const dateTo = searchParams.get('dateTo')

  if (!vendorId || !dateFrom || !dateTo) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
  }

  const result = await getWorkRecord(vendorId, dateFrom, dateTo)
  // Input problems are the caller's, not a server fault, so they do not look
  // like an incident to whoever is reading the logs.
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  if (!result.data) {
    return NextResponse.json({ error: 'No work record could be produced' }, { status: 404 })
  }

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await generateWorkRecordPDF({
      vendorName: result.data.vendor.name,
      periodFrom: dateFrom,
      periodTo: dateTo,
      record: result.data.record,
      monthlyCapIncVat: result.data.monthlyCapIncVat,
    })
  } catch (error) {
    console.error('[work-record] PDF generation failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not produce the work record' },
      { status: 500 }
    )
  }

  const vendorCode = result.data.vendor.name
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="work-record-${vendorCode}-${dateFrom}-${dateTo}.pdf"`,
      // A client's work history is sensitive, so no intermediary keeps a copy.
      'Cache-Control': 'no-store, private',
    },
  })
}
