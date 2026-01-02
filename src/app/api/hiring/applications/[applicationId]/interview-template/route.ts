import { NextRequest, NextResponse } from 'next/server'

// Ensure Node.js runtime for Puppeteer usage
export const runtime = 'nodejs'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { generateInterviewTemplateHtml } from '@/lib/hiring/interview-template'
import { generatePDFFromHTML } from '@/lib/pdf-generator'

// Helper to get absolute logo URL
function getLogoUrl() {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    return `${appUrl}/logo.png`
}

export async function GET(request: NextRequest, context: { params: Promise<{ applicationId: string }> }) {
    const { applicationId } = await context.params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        return new NextResponse('Unauthorized', { status: 401 })
    }

    const hasPermission = await checkUserPermission('hiring', 'view')
    if (!hasPermission) {
        return new NextResponse('Permission denied', { status: 403 })
    }

    const admin = createAdminClient()
    const { data: application, error } = await admin
        .from('hiring_applications')
        .select(`
            *,
            candidate:hiring_candidates(*),
            job:hiring_jobs(*, template:hiring_job_templates(*))
        `)
        .eq('id', applicationId)
        .single()

    if (error || !application) {
        return new NextResponse('Application not found', { status: 404 })
    }

    const candidate = (application as any).candidate
    const job = (application as any).job
    const template = job?.template ?? null

    if (!candidate || !job) {
        return new NextResponse('Candidate data missing', { status: 500 })
    }

    const html = generateInterviewTemplateHtml({
        application,
        candidate,
        job,
        template,
        logoUrl: getLogoUrl()
    })

    try {
        const pdfBuffer = await generatePDFFromHTML(html, {
            margin: { top: '0', right: '0', bottom: '0', left: '0' }, // Margins handled in CSS
            printBackground: true,
        })

        return new NextResponse(pdfBuffer as unknown as BodyInit, {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="interview-template-${candidate.first_name}-${candidate.last_name}.pdf"`,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
            },
        })
    } catch (e) {
        console.error('PDF Generation Error:', e)
        return new NextResponse('Failed to generate PDF', { status: 500 })
    }
}
