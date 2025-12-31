import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE } from '@/lib/constants'

const HIRING_DOCS_BUCKET = 'hiring-docs'

const PresignSchema = z.object({
    fileName: z.string().min(1),
    fileSize: z.coerce.number().int().positive().max(MAX_FILE_SIZE),
    mimeType: z.string().optional(),
})

function sanitizeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function guessMimeType(fileName: string): string | null {
    const extension = fileName.split('.').pop()?.toLowerCase()
    switch (extension) {
        case 'pdf':
            return 'application/pdf'
        case 'doc':
            return 'application/msword'
        case 'docx':
            return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        case 'jpg':
        case 'jpeg':
            return 'image/jpeg'
        case 'png':
            return 'image/png'
        case 'gif':
            return 'image/gif'
        default:
            return null
    }
}

export async function OPTIONS() {
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
            const parsed = PresignSchema.parse(body)

            const safeFileName = sanitizeFileName(parsed.fileName)
            const inferredMimeType = guessMimeType(safeFileName)
            const mimeType = (parsed.mimeType || inferredMimeType || '').toLowerCase()

            if (!mimeType || !ALLOWED_FILE_TYPES.includes(mimeType)) {
                return createErrorResponse('Unsupported file type', 'VALIDATION_ERROR', 400)
            }

            const storagePath = `resumes/${Date.now()}-${crypto.randomUUID()}-${safeFileName}`
            const admin = createAdminClient()

            const { data, error } = await admin.storage
                .from(HIRING_DOCS_BUCKET)
                .createSignedUploadUrl(storagePath, { upsert: false })

            if (error || !data?.signedUrl || !data?.token) {
                return createErrorResponse(error?.message || 'Failed to create signed upload URL', 'UPLOAD_ERROR', 400)
            }

            const { data: publicData } = admin.storage
                .from(HIRING_DOCS_BUCKET)
                .getPublicUrl(storagePath)

            return createApiResponse({
                storagePath,
                fileName: safeFileName,
                mimeType,
                fileSize: parsed.fileSize,
                signedUrl: data.signedUrl,
                token: data.token,
                resumeUrl: publicData?.publicUrl || null,
                publicUrl: publicData?.publicUrl || null,
            }, 201)
        } catch (error) {
            if (error instanceof z.ZodError) {
                return createErrorResponse('Validation error', 'VALIDATION_ERROR', 400, error.errors)
            }
            console.error('Error in hiring/resumes/presign API', error)
            return createErrorResponse('Failed to create signed upload URL', 'INTERNAL_ERROR', 500)
        }
    }, ['write:hiring'], request)
}
