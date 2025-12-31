import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'

const ConfirmationSchema = z.object({
    confirmations: z.record(z.any()).optional(),
    note: z.string().max(2000).optional(),
    resumeUrl: z.string().url().optional(),
    resumeStoragePath: z.string().min(1).optional(),
    resumeFileName: z.string().min(1).optional(),
    resumeMimeType: z.string().min(1).optional(),
    resumeFileSize: z.coerce.number().int().positive().optional(),
})

function extractStoragePathFromUrl(url?: string) {
    if (!url) return null
    if (!url.startsWith('http')) {
        return url
    }
    try {
        const parsed = new URL(url)
        const marker = '/storage/v1/object/public/hiring-docs/'
        const index = parsed.pathname.indexOf(marker)
        if (index >= 0) {
            return parsed.pathname.slice(index + marker.length)
        }
        const parts = parsed.pathname.split('/hiring-docs/')
        if (parts.length === 2) {
            return parts[1]
        }
    } catch {
        return null
    }
    return null
}

function resolveFileName(inputName?: string, storagePath?: string, resumeUrl?: string) {
    if (inputName?.trim()) return inputName.trim()
    if (storagePath) {
        const name = storagePath.split('/').pop()
        if (name) return name
    }
    if (resumeUrl) {
        try {
            const parsed = new URL(resumeUrl)
            const name = parsed.pathname.split('/').pop()
            if (name) return name
        } catch {
            return 'resume'
        }
    }
    return 'resume'
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

export async function POST(request: NextRequest, context: { params: Promise<{ applicationId: string }> }) {
    return withApiAuth(async (req) => {
        try {
            const { applicationId } = await context.params
            const body = await req.json()
            const parsed = ConfirmationSchema.parse(body)
            const admin = createAdminClient()

            const { data: application, error: applicationError } = await admin
                .from('hiring_applications')
                .select('id, candidate_id, job_id')
                .eq('id', applicationId)
                .single()

            if (applicationError || !application) {
                return createErrorResponse('Application not found', 'NOT_FOUND', 404)
            }

            const confirmations = parsed.confirmations ?? {}
            const note = parsed.note?.trim() || null
            const hasConfirmations = Object.keys(confirmations).length > 0
            const hasNote = Boolean(note)
            const metadata: Record<string, any> = {}

            if (hasConfirmations) {
                metadata.confirmations = confirmations
            }
            if (hasNote) {
                metadata.note = note
            }

            const resumeStoragePath = parsed.resumeStoragePath || extractStoragePathFromUrl(parsed.resumeUrl)
            let resumeUrl = parsed.resumeUrl
            let documentId: string | null = null

            const hasResume = Boolean(resumeStoragePath || resumeUrl)

            if (!hasConfirmations && !hasNote && !hasResume) {
                return createErrorResponse('No confirmation data provided', 'VALIDATION_ERROR', 400)
            }

            if (hasResume) {
                const storageValue = resumeStoragePath || resumeUrl
                const fileName = resolveFileName(parsed.resumeFileName, resumeStoragePath || undefined, resumeUrl)

                if (storageValue) {
                    const { data: document, error: documentError } = await admin
                        .from('hiring_candidate_documents')
                        .insert({
                            candidate_id: application.candidate_id,
                            storage_path: storageValue,
                            file_name: fileName,
                            mime_type: parsed.resumeMimeType,
                            file_size_bytes: parsed.resumeFileSize,
                            source: 'website',
                        })
                        .select('id')
                        .single()

                    if (documentError) {
                        console.error('Error creating candidate document:', documentError)
                    } else {
                        documentId = document?.id || null
                    }
                }

                if (!resumeUrl && resumeStoragePath) {
                    const { data: publicData } = admin.storage
                        .from('hiring-docs')
                        .getPublicUrl(resumeStoragePath)
                    resumeUrl = publicData?.publicUrl || undefined
                }

                if (resumeUrl) {
                    await admin
                        .from('hiring_candidates')
                        .update({ resume_url: resumeUrl })
                        .eq('id', application.candidate_id)
                }

                metadata.resume = {
                    storage_path: resumeStoragePath || null,
                    resume_url: resumeUrl || null,
                    document_id: documentId,
                }
            }

            await admin.from('hiring_candidate_events').insert({
                candidate_id: application.candidate_id,
                application_id: application.id,
                job_id: application.job_id,
                event_type: 'candidate_confirmation',
                source: 'website',
                metadata,
            })

            if (hasResume) {
                try {
                    const { jobQueue } = await import('@/lib/unified-job-queue')
                    await jobQueue.enqueue('parse_cv', {
                        candidateId: application.candidate_id,
                        resumeUrl,
                        storagePath: resumeStoragePath,
                        documentId,
                        applicationId: application.id,
                        jobId: application.job_id,
                    })
                } catch (queueError) {
                    console.error('Failed to enqueue CV parsing job:', queueError)
                }
            }

            return createApiResponse({ success: true })
        } catch (error) {
            if (error instanceof z.ZodError) {
                return createErrorResponse('Validation error', 'VALIDATION_ERROR', 400, error.errors)
            }
            console.error('Error in hiring application confirm API', error)
            return createErrorResponse('Failed to record confirmation', 'INTERNAL_ERROR', 500)
        }
    }, ['write:hiring'], request)
}
