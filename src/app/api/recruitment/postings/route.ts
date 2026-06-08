import { NextRequest } from 'next/server'
import { createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { listPublicRecruitmentPostings } from '@/services/recruitment'

export async function OPTIONS() {
  return createApiResponse({}, 200)
}

export async function GET(_request: NextRequest) {
  try {
    const postings = await listPublicRecruitmentPostings(createAdminClient())
    return createApiResponse({ postings }, 200)
  } catch (error) {
    console.error('Failed to load public recruitment postings', error)
    return createErrorResponse('Failed to load recruitment postings', 'RECRUITMENT_POSTINGS_FAILED', 500)
  }
}

