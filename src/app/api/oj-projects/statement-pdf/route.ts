import { NextRequest, NextResponse } from 'next/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { getClientStatement } from '@/app/actions/oj-projects/client-statement'
import { generateStatementPDF } from '@/lib/oj-statement'

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

  const result = await getClientStatement(vendorId, dateFrom, dateTo)
  if (result.error || !result.statement) {
    return NextResponse.json({ error: result.error || 'Failed to generate statement' }, { status: 500 })
  }

  const { statement } = result

  const pdfBuffer = await generateStatementPDF({
    vendorName: statement.vendor.name,
    periodFrom: dateFrom,
    periodTo: dateTo,
    openingBalance: statement.openingBalance,
    transactions: statement.transactions,
    closingBalance: statement.closingBalance,
  })

  const vendorCode = statement.vendor.name
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="statement-${vendorCode}-${dateFrom}-${dateTo}.pdf"`,
    },
  })
}
