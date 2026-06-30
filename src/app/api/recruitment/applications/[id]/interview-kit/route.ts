import { NextRequest, NextResponse } from 'next/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { parseRecruitmentCv, RECRUITMENT_CV_BUCKET } from '@/lib/recruitment/files'
import {
  generateRecruitmentInterviewKitHtml,
  sanitizeRecruitmentKitFilename,
} from '@/lib/recruitment/interview-kit-template'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

function candidateName(candidate: any) {
  return [candidate?.first_name, candidate?.last_name].filter(Boolean).join(' ') || candidate?.email || 'candidate'
}

function mimeTypeFromPath(path: string | null | undefined) {
  const extension = path?.split('.').pop()?.toLowerCase()
  if (extension === 'pdf') return 'application/pdf'
  if (extension === 'doc') return 'application/msword'
  if (extension === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (extension === 'txt') return 'text/plain'
  if (extension === 'rtf') return 'application/rtf'
  if (extension === 'odt') return 'application/vnd.oasis.opendocument.text'
  return 'application/octet-stream'
}

async function mergePdfs(mainPdf: Buffer, appendPdf: Buffer): Promise<Buffer> {
  const { PDFDocument } = await import('pdf-lib')
  const mainDoc = await PDFDocument.load(mainPdf)
  const appendDoc = await PDFDocument.load(appendPdf)
  const copiedPages = await mainDoc.copyPages(appendDoc, appendDoc.getPageIndices())
  for (const page of copiedPages) {
    mainDoc.addPage(page)
  }
  return Buffer.from(await mainDoc.save())
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
    console.error('[recruitment interview kit] application fetch failed:', error)
    return new NextResponse('Failed to load application', { status: 500 })
  }
  if (!application) {
    return new NextResponse('Application not found', { status: 404 })
  }

  const { data: appointment } = await admin
    .from('recruitment_candidate_appointments')
    .select('*')
    .eq('application_id', applicationId)
    .order('scheduled_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  const candidate = (application as any).candidate ?? {}
  let cvPdfBytes: Buffer | null = null
  let cvText: string | null = typeof candidate.cv_text === 'string' ? candidate.cv_text : null

  if (candidate.cv_file_path) {
    const { data: cvFile, error: cvError } = await admin.storage
      .from(RECRUITMENT_CV_BUCKET)
      .download(candidate.cv_file_path)

    if (cvError || !cvFile) {
      console.warn('[recruitment interview kit] CV download failed:', cvError)
    } else {
      const bytes = Buffer.from(await cvFile.arrayBuffer())
      const fileName = candidate.cv_file_name || candidate.cv_file_path.split('/').pop() || 'candidate-cv'
      const mimeType = candidate.cv_mime_type || mimeTypeFromPath(fileName)

      if (mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
        cvPdfBytes = bytes
      } else if (!cvText) {
        const parsed = await parseRecruitmentCv({
          buffer: bytes,
          fileName,
          mimeType,
          sizeBytes: bytes.length,
        })
        cvText = parsed.status === 'done' ? parsed.text : null
      }
    }
  }

  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    const html = generateRecruitmentInterviewKitHtml({
      application,
      appointment: appointment ?? null,
      cvText: cvPdfBytes ? null : cvText,
      logoUrl: `${origin}/booking-confirmation/anchor-logo-black.png`,
    })

    let pdfBuffer = await generatePDFFromHTML(html, {
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: '0',
        right: '0',
        bottom: '0',
        left: '0',
      },
      displayHeaderFooter: false,
    })

    if (cvPdfBytes) {
      pdfBuffer = await mergePdfs(pdfBuffer, cvPdfBytes)
    }

    const disposition = request.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline'
    const filename = sanitizeRecruitmentKitFilename(
      `interview-kit-${candidateName(candidate)}.pdf`,
      `interview-kit-${applicationId}.pdf`,
    )

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  } catch (pdfError) {
    console.error('[recruitment interview kit] PDF generation failed:', pdfError)
    return new NextResponse('Failed to generate interview kit PDF', { status: 500 })
  }
}
