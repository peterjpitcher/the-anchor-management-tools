import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'src/app/actions/recruitment.ts'), 'utf8')
const dashboardClientSource = readFileSync(
  resolve(process.cwd(), 'src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx'),
  'utf8',
)

function auditBlock(operation: string, resource: string) {
  const start = source.indexOf(`operation: '${operation}',\n      resource: '${resource}'`)
  if (start === -1) return ''
  return source.slice(start, source.indexOf("revalidatePath('/recruitment')", start))
}

function actionBlock(name: string) {
  const start = source.indexOf(`export async function ${name}`)
  if (start === -1) return ''
  const next = source.indexOf('\nexport async function ', start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

describe('recruitment audit source coverage', () => {
  it('covers recruitment mutations with non-PII audit payloads', () => {
    expect(source.match(/auditRecruitmentMutation\(\{/g)?.length ?? 0).toBeGreaterThanOrEqual(25)

    const candidateAudit = auditBlock('update', 'recruitment_candidate')
    expect(candidateAudit).toContain('changed_fields')
    expect(candidateAudit).not.toContain('email: formString')
    expect(candidateAudit).not.toContain('phone: formString')

    const erasureAudit = auditBlock('erase', 'recruitment_candidate')
    expect(erasureAudit).toContain('pii_erased: true')
    expect(erasureAudit).toContain('reason_recorded')
    expect(erasureAudit).not.toContain('reason:')
  })

  it('updates application status after reviewed decision emails send', () => {
    expect(source).toContain('const EMAIL_STATUS_TRANSITIONS')
    expect(source).toContain("interview_invite: {\n    status: 'interview_invited'")
    expect(source).toContain("trial_invite: {\n    status: 'trial_offered'")
    expect(source).toContain("offer: {\n    status: 'offered'")
    expect(source).toContain("rejection: {\n    status: 'rejected'")
    expect(source).toContain("already_considered: {\n    status: 'declined_duplicate'")

    const sendEmailAction = actionBlock('sendRecruitmentDecisionEmailAction')
    expect(sendEmailAction).toContain('const result = await sendRecruitmentTemplateEmail')
    expect(sendEmailAction).toContain('const statusTransition = EMAIL_STATUS_TRANSITIONS[type]')
    expect(sendEmailAction).toContain('await transitionRecruitmentApplicationStatus(applicationId, statusTransition.status')
    expect(sendEmailAction).toContain('communication_id: result.communicationId')
    expect(sendEmailAction).toContain('status_update_error: statusUpdateError')
    expect(sendEmailAction.indexOf('const result = await sendRecruitmentTemplateEmail')).toBeLessThan(
      sendEmailAction.indexOf('await transitionRecruitmentApplicationStatus(applicationId, statusTransition.status'),
    )
  })

  it('does not send manager alert emails for booking invite sends', () => {
    const bookingInviteAction = actionBlock('issueRecruitmentBookingInviteAction')

    expect(bookingInviteAction).toContain('await issueRecruitmentBookingLink')
    expect(bookingInviteAction).toContain('await sendRecruitmentTemplateEmail')
    expect(bookingInviteAction).not.toContain('notifyRecruitmentManager')
    expect(bookingInviteAction).not.toContain('sendRecruitmentManagerAlert')
  })

  it('refreshes and warns in the reviewed email composer after sends', () => {
    expect(dashboardClientSource).toContain("import { useRouter } from 'next/navigation'")
    expect(dashboardClientSource).toContain('const router = useRouter()')
    expect(dashboardClientSource).toContain('router.refresh()')
    expect(dashboardClientSource).toContain('const previousEmailForDraft')
    expect(dashboardClientSource).toContain("['queued', 'sent'].includes(communication.delivery_status)")
    expect(dashboardClientSource).toContain('const duplicateEmailWarning')
  })

  it('keeps awaiting-booking applications visible in the pipeline', () => {
    const statusOptionsStart = dashboardClientSource.indexOf('const statusOptions')
    const statusOptionsEnd = dashboardClientSource.indexOf('const completedApplicationStatuses', statusOptionsStart)
    const statusOptionsBlock = dashboardClientSource.slice(statusOptionsStart, statusOptionsEnd)
    const pipelineStart = dashboardClientSource.indexOf('const pipeline = useMemo')
    const pipelineEnd = dashboardClientSource.indexOf('const selectedApplicationEvents', pipelineStart)
    const pipelineBlock = dashboardClientSource.slice(pipelineStart, pipelineEnd)

    expect(statusOptionsBlock).toContain("'interview_invited'")
    expect(statusOptionsBlock).toContain("'trial_offered'")
    expect(pipelineBlock).toContain('populatedStatuses.has(status)')
    expect(pipelineBlock).not.toContain('defaultPipelineStatuses')
    expect(pipelineBlock).not.toContain('.slice(0, 6)')
  })

  it('keeps recruitment drawer actions clear and status-aware', () => {
    // Every action lives in one stage-aware action bar rather than being scattered
    // across the tabs, so these labels must stay reachable from the mapping itself.
    expect(dashboardClientSource).toContain('function drawerStageActions')
    expect(dashboardClientSource).toContain('function recruitmentNextActionHint')
    expect(dashboardClientSource).toContain("status('Shortlist', 'shortlisted')")
    expect(dashboardClientSource).toContain("status('Mark interviewed', 'interviewed')")
    expect(dashboardClientSource).toContain('Send interview booking link')
    expect(dashboardClientSource).toContain('Resend interview booking link')
    // No trial booking link: trials are assigned by staff around the rota.
    expect(dashboardClientSource).toContain("label: 'Book trial directly'")
    expect(dashboardClientSource).toContain('Change stage manually')
    expect(dashboardClientSource).toContain('Re-score AI fit')
    expect(dashboardClientSource).toContain('Create employee invite')
    expect(dashboardClientSource).toContain('Archive application')
    expect(dashboardClientSource).toContain('Restore application')
  })

  it('keeps the drawer action bar and tabs pinned above the scrolling tab body', () => {
    // The action bar only solves "I can never find what I need" if it stays on
    // screen. Losing the sticky wrapper would silently undo that.
    expect(dashboardClientSource).toContain('sticky top-0 z-20 -mx-5 -mt-5 bg-surface px-5 pb-3 pt-5')
    expect(dashboardClientSource).toContain('{primaryStageAction && renderStageAction(primaryStageAction')
    expect(dashboardClientSource).toContain('{secondaryStageAction && renderStageAction(secondaryStageAction')
  })

  it('names the drawer tabs after the question each one answers', () => {
    expect(dashboardClientSource).toContain("{ id: 'candidate', label: 'Candidate' }")
    expect(dashboardClientSource).toContain("{ id: 'progress', label: 'Progress' }")
    expect(dashboardClientSource).toContain("{ id: 'messages', label: 'Messages' }")
    expect(dashboardClientSource).toContain("{ id: 'notes', label: 'Notes' }")
    // The drawer no longer guesses a tab from the status; the action bar adapts instead.
    expect(dashboardClientSource).not.toContain("['interview_invited', 'trial_offered'].includes(application.status) ? 'schedule' : 'overview'")
  })

  it('shows what was actually sent to the candidate inside the drawer', () => {
    // `final_body` was always loaded but used to be readable only from the
    // dashboard's global Communications tab.
    expect(dashboardClientSource).toContain('{communication.final_body}')
  })

  it('keeps candidate profile fields labelled and compact', () => {
    expect(dashboardClientSource).toContain('function ProfileField')
    expect(dashboardClientSource).toContain('label="First name"')
    expect(dashboardClientSource).toContain('label="Last name"')
    expect(dashboardClientSource).toContain('label="Email"')
    expect(dashboardClientSource).toContain('label="Phone"')
    expect(dashboardClientSource).toContain('label="Location"')
    expect(dashboardClientSource).toContain('label="Right to work"')
    expect(dashboardClientSource).toContain('label="Document type"')
    expect(dashboardClientSource).toContain('label="Recruitment notes"')
  })
})
