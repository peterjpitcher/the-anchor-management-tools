'use server'

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { jobQueue } from '@/lib/unified-job-queue'
import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/app/actions/audit'
import { revalidatePath } from 'next/cache'

const RerunSchema = z.object({
    applicationId: z.string().uuid(),
    reason: z.string().max(500).optional(),
})

const SetActiveSchema = z.object({
    applicationId: z.string().uuid(),
    runId: z.string().uuid(),
})

function buildEligibility(evidence: Array<{ key?: string | null; label?: string | null; status?: string; evidence?: string }>) {
    return evidence.map((item) => ({
        key: item.key ?? null,
        label: item.label ?? null,
        status: item.status === 'yes' || item.status === 'no' ? item.status : 'unclear',
        justification: (item.evidence || '').toString().slice(0, 400) || 'Not enough detail provided.',
    }))
}

export async function rerunApplicationScreeningAction(input: { applicationId: string; reason?: string }) {
    const allowed = await checkUserPermission('hiring', 'edit')
    if (!allowed) return { success: false, error: 'Unauthorized' }

    const parse = RerunSchema.safeParse(input)
    if (!parse.success) {
        return { success: false, error: parse.error.issues[0].message }
    }

    const admin = createAdminClient()
    const { data: application, error } = await admin
        .from('hiring_applications')
        .select('id')
        .eq('id', parse.data.applicationId)
        .single()

    if (error || !application) {
        return { success: false, error: 'Application not found' }
    }

    await admin
        .from('hiring_applications')
        .update({
            screening_status: 'pending',
            screening_error: null,
            screening_updated_at: new Date().toISOString(),
        })
        .eq('id', application.id)

    const jobResult = await jobQueue.enqueue(
        'screen_application',
        {
            applicationId: application.id,
            force: true,
            runType: 'manual',
            runReason: parse.data.reason || null,
        },
        { unique: `screen_application:${application.id}:${Date.now()}` }
    )

    if (!jobResult.success) {
        // Revert status if job failed to enqueue
        await admin
            .from('hiring_applications')
            .update({
                screening_status: 'failed',
                screening_error: `Failed to enqueue job: ${jobResult.error}`,
                screening_updated_at: new Date().toISOString(),
            })
            .eq('id', application.id)

        return { success: false, error: jobResult.error || 'Failed to enqueue screening job' }
    }

    const userClient = await createClient()
    const { data: { user } } = await userClient.auth.getUser()
    if (user) {
        await logAuditEvent({
            user_id: user.id,
            user_email: user.email ?? undefined,
            operation_type: 'screening_rerun',
            resource_type: 'hiring_application',
            resource_id: application.id,
            operation_status: 'success',
            additional_info: { reason: parse.data.reason || null },
        })
    }

    revalidatePath(`/hiring/applications/${application.id}`)
    return { success: true }
}

export async function setActiveScreeningRunAction(input: { applicationId: string; runId: string }) {
    const allowed = await checkUserPermission('hiring', 'edit')
    if (!allowed) return { success: false, error: 'Unauthorized' }

    const parse = SetActiveSchema.safeParse(input)
    if (!parse.success) {
        return { success: false, error: parse.error.issues[0].message }
    }

    const admin = createAdminClient()
    const { data: run, error } = await admin
        .from('hiring_screening_runs')
        .select('*')
        .eq('id', parse.data.runId)
        .eq('application_id', parse.data.applicationId)
        .single()

    if (error || !run) {
        return { success: false, error: 'Screening run not found' }
    }

    if (run.status !== 'success') {
        return { success: false, error: 'Only successful runs can be set active' }
    }

    const evidence = Array.isArray(run.evidence) ? run.evidence : []
    const eligibility = buildEligibility(evidence)

    const aiScreeningResult = {
        eligibility,
        evidence,
        strengths: Array.isArray(run.strengths) ? run.strengths : [],
        concerns: Array.isArray(run.concerns) ? run.concerns : [],
        rationale: (run.result_raw as any)?.rationale || null,
        experience_analysis: run.experience_analysis || null,
        draft_replies: run.draft_replies || null,
        confidence: run.confidence ?? null,
        guardrails_followed: (run.result_raw as any)?.guardrails_followed ?? null,
        model_score: run.score_raw ?? null,
        model_recommendation: run.recommendation_raw ?? null,
        prompt_version: run.prompt_version || null,
        generated_at: new Date().toISOString(),
        model: run.model || null,
    }

    const { error: updateError } = await admin
        .from('hiring_applications')
        .update({
            ai_score: run.score_calibrated ?? null,
            ai_recommendation: run.recommendation_calibrated ?? null,
            ai_score_raw: run.score_raw ?? null,
            ai_recommendation_raw: run.recommendation_raw ?? null,
            ai_confidence: run.confidence ?? null,
            ai_screening_result: aiScreeningResult,
            screening_status: 'success',
            screening_error: null,
            screening_updated_at: new Date().toISOString(),
            latest_screening_run_id: run.id,
        })
        .eq('id', parse.data.applicationId)

    if (updateError) {
        return { success: false, error: updateError.message || 'Failed to update application' }
    }

    const userClient = await createClient()
    const { data: { user } } = await userClient.auth.getUser()
    if (user) {
        await logAuditEvent({
            user_id: user.id,
            user_email: user.email ?? undefined,
            operation_type: 'screening_set_active',
            resource_type: 'hiring_application',
            resource_id: parse.data.applicationId,
            operation_status: 'success',
            additional_info: { run_id: run.id },
        })
    }

    revalidatePath(`/hiring/applications/${parse.data.applicationId}`)
    return { success: true }
}
