import { NextRequest, NextResponse } from 'next/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { sanitizeRecruitmentKitFilename } from '@/lib/recruitment/interview-kit-template'
import { generateRecruitmentTrialBriefHtml } from '@/lib/recruitment/trial-brief-template'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

function candidateName(candidate: any) {
  return [candidate?.first_name, candidate?.last_name].filter(Boolean).join(' ') || candidate?.email || 'candidate'
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: applicationId } = await params
  if (!applicationId) {
    return new NextResponse('Application ID required', { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const hasPermission = await checkUserPermission('recruitment', 'view', user.id)
  if (!hasPermission) {
    return new NextResponse('Permission denied', { status: 403 })
  }

  const admin = createAdminClient()
  const { data: application, error } = await admin
    .from('recruitment_applications')
    .select('*, candidate:recruitment_candidates(*), job_posting:recruitment_job_postings(*)')
    .eq('id', applicationId)
    .maybeSingle()

  if (error) {
    console.error('[recruitment trial brief] application fetch failed:', error)
    return new NextResponse('Failed to load application', { status: 500 })
  }
  if (!application) {
    return new NextResponse('Application not found', { status: 404 })
  }

  const { data: appointment } = await admin
    .from('recruitment_candidate_appointments')
    .select('*')
    .eq('application_id', applicationId)
    .eq('type', 'trial_shift')
    .order('scheduled_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    const html = generateRecruitmentTrialBriefHtml({
      application,
      appointment: appointment ?? null,
      logoUrl: `${origin}/booking-confirmation/anchor-logo-black.png`,
    })

    const pdfBuffer = await generatePDFFromHTML(html, {
      // A4 to match the venue's paper. The margins are in the document itself.
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      displayHeaderFooter: false,
    })

    const disposition = request.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline'
    const filename = sanitizeRecruitmentKitFilename(
      `trial-brief-${candidateName((application as any).candidate)}.pdf`,
      `trial-brief-${applicationId}.pdf`,
    )

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  } catch (pdfError) {
    console.error('[recruitment trial brief] PDF generation failed:', pdfError)
    return new NextResponse('Failed to generate trial brief PDF', { status: 500 })
  }
}
