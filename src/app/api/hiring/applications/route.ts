import { NextRequest } from 'next/server'
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { submitApplication } from '@/lib/hiring/service'
import { z } from 'zod'

const ApplicationSchema = z.object({
    jobId: z.string().uuid(),
    source: z.enum(['website', 'indeed', 'linkedin', 'referral', 'walk_in', 'agency', 'other']).optional(),
    candidate: z.object({
        firstName: z.string().min(1, 'First name is required'),
        lastName: z.string().min(1, 'Last name is required'),
        email: z.string().email('Invalid email address'),
        phone: z.string().min(1, 'Phone number is required'),
        location: z.string().optional(),
        resumeUrl: z.string().url().optional(),
        resumeStoragePath: z.string().min(1).optional(),
        resumeFileName: z.string().min(1).optional(),
        resumeMimeType: z.string().min(1).optional(),
        resumeFileSize: z.coerce.number().int().positive().optional(),
        screenerAnswers: z.record(z.any()).optional().default({}),
    })
})

export async function OPTIONS(request: NextRequest) {
    return new Response(null, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
            'Access-Control-Max-Age': '86400',
        },
    })
}

export async function POST(request: NextRequest) {
    return withApiAuth(async (req) => {
        try {
            const body = await req.json()
            const valid = ApplicationSchema.parse(body)

            const result = await submitApplication(valid)

            // Check for success/failure in result object if it returns one
            if (typeof result === 'object' && 'success' in result && !result.success) {

                return createErrorResponse(result.error || 'Failed to submit', 'APPLICATION_ERROR', 400)
            }

            return createApiResponse(result, 201)
        } catch (error) {
            if (error instanceof z.ZodError) {
                return createErrorResponse('Validation error', 'VALIDATION_ERROR', 400, error.errors)
            }
            console.error('Error in hiring/applications API', error)
            return createErrorResponse('Failed to submit application', 'INTERNAL_ERROR', 500)
        }
    }, ['write:hiring'], request)
}
