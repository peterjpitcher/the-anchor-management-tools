import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { buildPayrollWorkbook, getPayrollFilename, type PayrollRow } from '@/lib/rota/excel-export';

// GET /api/rota/export?year=2026&month=2
// Streams the payroll Excel file for an approved month.

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const canExport = await checkUserPermission('payroll', 'export');
  if (!canExport) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get('year') ?? '0');
  const month = parseInt(searchParams.get('month') ?? '0');

  if (!year || !month || month < 1 || month > 12) {
    return NextResponse.json({ error: 'Invalid year or month' }, { status: 400 });
  }

  // Load approved snapshot
  const { data: approval, error } = await supabase
    .from('payroll_month_approvals')
    .select('snapshot')
    .eq('year', year)
    .eq('month', month)
    .single();

  if (error || !approval) {
    return NextResponse.json({ error: 'Month has not been approved yet' }, { status: 409 });
  }

  const snapshot = approval.snapshot as { rows: PayrollRow[] };
  const xlsxBuffer = await buildPayrollWorkbook(year, month, snapshot.rows);
  const filename = getPayrollFilename(year, month);

  return new NextResponse(xlsxBuffer.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': xlsxBuffer.length.toString(),
    },
  });
}
