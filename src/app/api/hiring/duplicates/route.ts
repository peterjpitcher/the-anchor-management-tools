import { NextRequest } from 'next/server'
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'

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

export async function GET(request: NextRequest) {
    return withApiAuth(async () => {
        try {
            const admin = createAdminClient()
            const { data, error } = await admin
                .from('hiring_candidate_events')
                .select(`
                    id,
                    candidate_id,
                    application_id,
                    job_id,
                    metadata,
                    created_at,
                    candidate:hiring_candidates(
                        id,
                        first_name,
                        last_name,
                        email,
                        phone,
                        location
                    )
                `)
                .eq('event_type', 'possible_duplicate')
                .order('created_at', { ascending: false })

            if (error) {
                console.error('Error fetching duplicate review queue:', error)
                return createErrorResponse('Failed to fetch duplicate queue', 'INTERNAL_ERROR', 500)
            }

            const items = (data || []).filter((event) => {
                const status = (event as any)?.metadata?.review_status
                return !status || status === 'open'
            })

            return createApiResponse({ items })
        } catch (error) {
            console.error('Error in hiring duplicates API', error)
            return createErrorResponse('Failed to fetch duplicate queue', 'INTERNAL_ERROR', 500)
        }
    }, ['read:hiring'], request)
}
