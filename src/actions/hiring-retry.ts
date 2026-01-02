'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { jobQueue } from '@/lib/unified-job-queue'
import { logAuditEventLegacy } from '@/app/actions/audit'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { parseResumeTextWithUsage } from '@/lib/hiring/parsing'

export async function retryCandidateParsing(candidateId: string) {
    const allowed = await checkUserPermission('hiring', 'edit')
    if (!allowed) return { success: false, error: 'Unauthorized' }

    const supabase = createAdminClient()
    const { data: candidate, error: fetchError } = await supabase
        .from('hiring_candidates')
        .select('id, first_name, resume_url')
        .eq('id', candidateId)
        .single()

    if (fetchError || !candidate) {
        return { success: false, error: 'Candidate not found' }
    }

    if (!candidate.resume_url) {
        return { success: false, error: 'Candidate has no resume to parse' }
    }

    // Reset status to parsing
    const { error: updateError } = await supabase
        .from('hiring_candidates')
        .update({
            parsing_status: 'pending',
            parsing_error: null,
            parsing_updated_at: new Date().toISOString(),
            parsed_data: {},
            resume_text: null,
        })
        .eq('id', candidateId)

    if (updateError) {
        return { success: false, error: 'Failed to reset candidate status' }
    }

    // Enqueue new parse job
    await jobQueue.enqueue('parse_cv', {
        candidateId: candidate.id,
        resumeUrl: candidate.resume_url,
    })

    const userClient = await createClient()
    const { data: { user } } = await userClient.auth.getUser()

    if (user) {
        await logAuditEventLegacy(
            user.id,
            'candidate.retry_parsing',
            { candidate_id: candidate.id, manual_retry: true }
        )
    }

    revalidatePath(`/hiring/candidates/${candidateId}`)
    return { success: true }
}

const ManualResumeSchema = z.object({
    candidateId: z.string().uuid(),
    resumeText: z.string().min(50, 'Resume text is too short'),
})

function normalizeEmail(email: string) {
    return email.trim().toLowerCase()
}

function isPlaceholderEmail(email?: string | null) {
    if (!email) return true
    return email.startsWith('pending-') || email.endsWith('@hiring.temp')
}

export async function submitManualResumeText(input: { candidateId: string; resumeText: string }) {
    const allowed = await checkUserPermission('hiring', 'edit')
    if (!allowed) return { success: false, error: 'Unauthorized' }

    const parse = ManualResumeSchema.safeParse(input)
    if (!parse.success) {
        return { success: false, error: parse.error.issues[0].message }
    }

    try {
        const admin = createAdminClient()
        const { data: candidate, error: candidateError } = await admin
            .from('hiring_candidates')
            .select('id, email, phone, location, first_name, last_name, secondary_emails')
            .eq('id', parse.data.candidateId)
            .single()

        if (candidateError || !candidate) {
            return { success: false, error: 'Candidate not found' }
        }

        const parseResult = await parseResumeTextWithUsage(parse.data.resumeText)
        const parsedData = parseResult.parsedData
        const updates: Record<string, any> = {
            parsed_data: parsedData,
            resume_text: parseResult.resumeText,
            parsing_status: 'manual',
            parsing_error: null,
            parsing_updated_at: new Date().toISOString(),
        }

        if ((candidate.first_name === 'Parsing' || !candidate.first_name) && parsedData.first_name) {
            updates.first_name = parsedData.first_name
        }
        if ((candidate.last_name === 'CV...' || !candidate.last_name) && parsedData.last_name) {
            updates.last_name = parsedData.last_name
        }
        if (isPlaceholderEmail(candidate.email) && parsedData.email) {
            updates.email = parsedData.email
        }
        if (!candidate.phone && parsedData.phone) {
            updates.phone = parsedData.phone
        }
        if (!candidate.location && parsedData.location) {
            updates.location = parsedData.location
        }

        const secondaryEmails = new Set<string>(Array.isArray(candidate.secondary_emails) ? candidate.secondary_emails : [])
        const parsedPrimaryEmail = normalizeEmail(parsedData.email)
        const existingPrimaryEmail = normalizeEmail(candidate.email)

        if (parsedPrimaryEmail && parsedPrimaryEmail !== existingPrimaryEmail && !isPlaceholderEmail(candidate.email)) {
            secondaryEmails.add(parsedPrimaryEmail)
        }

        if (Array.isArray(parsedData.secondary_emails)) {
            parsedData.secondary_emails.forEach((email) => {
                const normalized = normalizeEmail(email)
                if (normalized && normalized !== existingPrimaryEmail) {
                    secondaryEmails.add(normalized)
                }
            })
        }

        if (secondaryEmails.size > 0) {
            updates.secondary_emails = Array.from(secondaryEmails)
        }

        let profileVersionId: string | null = null
        const latestVersion = await admin
            .from('hiring_candidate_profile_versions')
            .select('id, version_number, parsed_data')
            .eq('candidate_id', candidate.id)
            .order('version_number', { ascending: false })
            .limit(1)
            .maybeSingle()

        const previousData = latestVersion.data?.parsed_data || {}
        const diffData: Record<string, any> = {}
        const allKeys = new Set([
            ...Object.keys(previousData || {}),
            ...Object.keys(parsedData || {}),
        ])

        allKeys.forEach((key) => {
            const beforeValue = (previousData as any)?.[key]
            const afterValue = (parsedData as any)?.[key]
            if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
                diffData[key] = { before: beforeValue ?? null, after: afterValue ?? null }
            }
        })

        const diffSummary = Object.keys(diffData).length
            ? `Updated fields: ${Object.keys(diffData).join(', ')}`
            : 'No changes detected'

        const { data: versionRow, error: versionError } = await admin
            .from('hiring_candidate_profile_versions')
            .insert({
                candidate_id: candidate.id,
                document_id: null,
                version_number: (latestVersion.data?.version_number || 0) + 1,
                parsed_data: parsedData,
                diff_summary: diffSummary,
                diff_data: diffData,
            })
            .select('id')
            .single()

        if (versionError) {
            return { success: false, error: versionError.message }
        }

        profileVersionId = versionRow?.id || null
        if (profileVersionId) {
            updates.current_profile_version_id = profileVersionId
        }

        const { error: updateError } = await admin
            .from('hiring_candidates')
            .update(updates)
            .eq('id', candidate.id)

        if (updateError) {
            return { success: false, error: updateError.message }
        }

        await admin.from('hiring_candidate_events').insert({
            candidate_id: candidate.id,
            event_type: 'cv_manual_text',
            source: 'internal',
            metadata: { text_length: parse.data.resumeText.length },
        })

        if (parseResult.usage) {
            await (admin.from('ai_usage_events') as any).insert([
                {
                    context: `hiring_parsing:${candidate.id}:manual_parse`,
                    model: parseResult.usage.model,
                    prompt_tokens: parseResult.usage.promptTokens,
                    completion_tokens: parseResult.usage.completionTokens,
                    total_tokens: parseResult.usage.totalTokens,
                    cost: parseResult.usage.cost,
                },
            ])
        }

        const userClient = await createClient()
        const { data: { user } } = await userClient.auth.getUser()
        if (user) {
            await logAuditEventLegacy(
                user.id,
                'candidate.manual_resume_text',
                { candidate_id: candidate.id, manual_text: true }
            )
        }

        revalidatePath(`/hiring/candidates/${candidate.id}`)
        return { success: true }
    } catch (error: any) {
        console.error('Manual resume parsing failed:', error)
        return { success: false, error: error.message || 'Failed to parse resume text' }
    }
}
