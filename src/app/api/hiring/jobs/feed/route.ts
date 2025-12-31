import { NextRequest } from 'next/server'
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { jobToSchema } from '@/lib/api/schema'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || ''

function buildJobUrls(job: { id: string; slug?: string | null }) {
  const slug = job.slug || job.id
  const jobPath = `/jobs/${slug}`
  const canonicalUrl = SITE_URL ? new URL(jobPath, SITE_URL).toString() : jobPath
  const applyUrl = SITE_URL ? new URL(`${jobPath}/apply`, SITE_URL).toString() : `${jobPath}/apply`

  return { canonicalUrl, applyUrl, slug }
}

export async function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      'Access-Control-Max-Age': '86400',
    },
  })
}

export async function GET(request: NextRequest) {
  return withApiAuth(async () => {
    try {
      const admin = createAdminClient()
      const nowIso = new Date().toISOString()
      const { data, error } = await admin
        .from('hiring_jobs')
        .select('*')
        .eq('status', 'open')
        .or(`closing_date.is.null,closing_date.gt.${nowIso}`)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching hiring job feed:', error)
        return createErrorResponse('Failed to fetch job feed', 'INTERNAL_ERROR', 500)
      }

      const jobs = (data || []).map((job) => {
        const { canonicalUrl, applyUrl, slug } = buildJobUrls(job)
        return {
          id: job.id,
          slug,
          status: job.status,
          title: job.title,
          description: job.description,
          location: job.location,
          employment_type: job.employment_type,
          salary_range: job.salary_range,
          requirements: job.requirements,
          prerequisites: job.prerequisites,
          screening_questions: job.screening_questions,
          screening_rubric: job.screening_rubric,
          posting_date: job.posting_date || job.created_at,
          closing_date: job.closing_date,
          canonical_url: canonicalUrl,
          apply_url: applyUrl,
          job_posting_schema: jobToSchema(job, { url: canonicalUrl, directApply: true }),
        }
      })

      return createApiResponse({ jobs })
    } catch (error) {
      console.error('Error in hiring job feed API', error)
      return createErrorResponse('Failed to fetch job feed', 'INTERNAL_ERROR', 500)
    }
  }, ['read:hiring'], request)
}
