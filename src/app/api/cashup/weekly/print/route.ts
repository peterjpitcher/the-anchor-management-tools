import { NextRequest, NextResponse } from 'next/server';

// Ensure Node.js runtime for Puppeteer usage
export const runtime = 'nodejs';

import { createClient } from '@/lib/supabase/server';
import { generatePDFFromHTML } from '@/lib/pdf-generator';
import { generateWeeklyCashupHTML, WeeklyReportRow } from '@/lib/cashing-up-pdf-template';
import { CashingUpService } from '@/services/cashing-up.service';
import { PermissionService } from '@/services/permission';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const siteId = searchParams.get('siteId');
  const weekStartDate = searchParams.get('weekStartDate');

  if (!siteId || !weekStartDate) {
    return new NextResponse('Missing siteId or weekStartDate', { status: 400 });
  }

  const supabase = await createClient();
  
  // Auth Check
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const hasPermission = await PermissionService.checkUserPermission('cashing_up', 'view', user.id);
  if (!hasPermission) return new NextResponse('Forbidden', { status: 403 });

  try {
    // Fetch Data
    // 1. Site Name
    const { data: site, error: siteError } = await supabase
      .from('sites')
      .select('name')
      .eq('id', siteId)
      .single();

    if (siteError || !site) {
      console.error('Failed to load site for weekly cashup print:', siteError);
      return new NextResponse('Failed to load site details', { status: 500 });
    }
    const siteName = site.name;

    // 2. Weekly Data
    const weekData = await CashingUpService.getWeeklyReportData(supabase, siteId, weekStartDate);

    // Generate HTML
    const html = generateWeeklyCashupHTML({
      weekData: weekData as WeeklyReportRow[],
      siteName,
      weekStartDate,
      logoUrl: process.env.NEXT_PUBLIC_APP_URL 
        ? `${process.env.NEXT_PUBLIC_APP_URL}/logo-oj.jpg`
        : undefined
    });

    // Generate PDF
    const pdfBuffer = await generatePDFFromHTML(html, {
      format: 'A4',
      landscape: true, // Weekly tables often better in landscape
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
    });

    // Return PDF
    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="weekly-cashup-${weekStartDate}.pdf"`,
        'Cache-Control': 'no-cache',
      },
    });

  } catch (error: any) {
    console.error('PDF Generation Error:', error);
    return new NextResponse('Failed to generate PDF', { status: 500 });
  }
}
