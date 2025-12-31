import { NextRequest } from 'next/server'
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'

function buildSummary(application: any) {
  const candidate = application?.candidate || {}
  const job = application?.job || {}
  const parsed = candidate?.parsed_data || {}

  const summaryText = typeof parsed.summary === 'string' ? parsed.summary : null
  const skills = Array.isArray(parsed.skills) ? parsed.skills.map((item: unknown) => String(item)) : []
  const experience = Array.isArray(parsed.experience) ? parsed.experience : []

  const contact = {
    firstName: candidate.first_name || null,
    lastName: candidate.last_name || null,
    email: candidate.email || null,
    phone: candidate.phone || null,
    location: candidate.location || null,
  }

  const sections = [
    {
      key: 'contact',
      label: 'Contact details',
      value: contact,
      hasData: Boolean(contact.email || contact.phone || contact.location),
    },
    {
      key: 'summary',
      label: 'Summary',
      value: summaryText,
      hasData: Boolean(summaryText),
    },
    {
      key: 'experience',
      label: 'Experience',
      value: experience,
      hasData: Array.isArray(experience) && experience.length > 0,
    },
    {
      key: 'skills',
      label: 'Skills',
      value: skills,
      hasData: Array.isArray(skills) && skills.length > 0,
    },
  ]

  return {
    applicationId: application.id,
    job: {
      id: job.id || null,
      title: job.title || null,
    },
    candidate: {
      id: candidate.id || null,
      ...contact,
      resumeUrl: candidate.resume_url || null,
    },
    parsed: {
      summary: summaryText,
      skills,
      experience,
      email: parsed.email || null,
      phone: parsed.phone || null,
      location: parsed.location || null,
    },
    sections,
  }
}

export async function OPTIONS() {
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

export async function GET(request: NextRequest, context: { params: Promise<{ applicationId: string }> }) {
  return withApiAuth(async () => {
    try {
      const { applicationId } = await context.params
      const admin = createAdminClient()
      const { data, error } = await admin
        .from('hiring_applications')
        .select(`
          id,
          job_id,
          candidate_id,
          candidate:hiring_candidates(
            id,
            first_name,
            last_name,
            email,
            phone,
            location,
            resume_url,
            parsed_data
          ),
          job:hiring_jobs(
            id,
            title
          )
        `)
        .eq('id', applicationId)
        .single()

      if (error || !data) {
        return createErrorResponse('Application not found', 'NOT_FOUND', 404)
      }

      const summary = buildSummary(data)
      return createApiResponse(summary)
    } catch (error) {
      console.error('Error in hiring summary API', error)
      return createErrorResponse('Failed to load summary', 'INTERNAL_ERROR', 500)
    }
  }, ['read:hiring'], request)
}
