import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE } from '@/lib/constants'

export type HiringResumeUploadResult = {
    storagePath: string
    publicUrl: string
    fileName: string
    mimeType: string
    fileSize: number
}

const HIRING_DOCS_BUCKET = 'hiring-docs'

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

export async function uploadHiringResume(file: File): Promise<HiringResumeUploadResult> {
    if (!file || file.size === 0) {
        throw new Error('A resume file is required')
    }

    if (file.size > MAX_FILE_SIZE) {
        throw new Error('File size exceeds the 10MB limit')
    }

    const safeFileName = sanitizeFileName(file.name || 'resume')
    const inferredMimeType = guessMimeType(safeFileName)
    const mimeType = file.type || inferredMimeType

    if (!mimeType || !ALLOWED_FILE_TYPES.includes(mimeType)) {
        throw new Error('Unsupported file type')
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const admin = createAdminClient()
    const uniqueId = crypto.randomUUID()
    const storagePath = `resumes/${Date.now()}-${uniqueId}-${safeFileName}`

    const { error: uploadError } = await admin.storage
        .from(HIRING_DOCS_BUCKET)
        .upload(storagePath, buffer, {
            contentType: mimeType,
            upsert: false,
        })

    if (uploadError) {
        throw new Error(uploadError.message)
    }

    const { data: publicData } = admin.storage
        .from(HIRING_DOCS_BUCKET)
        .getPublicUrl(storagePath)

    if (!publicData?.publicUrl) {
        throw new Error('Failed to generate resume URL')
    }

    return {
        storagePath,
        publicUrl: publicData.publicUrl,
        fileName: safeFileName,
        mimeType,
        fileSize: file.size,
    }
}
