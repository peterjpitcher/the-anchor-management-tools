import { NextRequest } from 'next/server'
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { getOpenJobs } from '@/lib/hiring/service'

// Handle CORS
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
    // Use 'read:hiring' permissions scope
    return withApiAuth(async (req) => {
        try {
            const jobs = await getOpenJobs()

            // Transform for public consumption if needed (e.g. remove internal fields)
            // For now, returning the raw record is fine as schema is public-safe
            return createApiResponse(jobs)
        } catch (error) {
            console.error('Error in hiring/jobs API', error)
            return createErrorResponse('Failed to fetch jobs', 'INTERNAL_ERROR', 500)
        }
    }, ['read:hiring'], request)
}
