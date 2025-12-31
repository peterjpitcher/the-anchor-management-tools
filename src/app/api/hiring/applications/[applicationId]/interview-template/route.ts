import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { generateInterviewTemplateHtml } from '@/lib/hiring/interview-template'

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
    })

    return new NextResponse(html, {
        headers: {
            'Content-Type': 'text/html',
            'Content-Disposition': `attachment; filename="interview-template-${applicationId.slice(0, 8)}.html"`,
        },
    })
}
