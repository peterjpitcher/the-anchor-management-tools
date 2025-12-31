import { NextRequest } from 'next/server'
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { uploadHiringResume } from '@/lib/hiring/uploads'

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
            const formData = await req.formData()
            const file = formData.get('file')

            if (!file || !(file instanceof File)) {
                return createErrorResponse('Resume file is required', 'VALIDATION_ERROR', 400)
            }

            const result = await uploadHiringResume(file)
            return createApiResponse({ ...result, resumeUrl: result.publicUrl }, 201)
        } catch (error: any) {
            console.error('Error in hiring/resumes API', error)
            return createErrorResponse(error.message || 'Failed to upload resume', 'UPLOAD_ERROR', 400)
        }
    }, ['write:hiring'], request)
}
