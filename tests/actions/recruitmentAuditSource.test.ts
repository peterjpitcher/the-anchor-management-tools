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
    const pipelineStart = dashboardClientSource.indexOf('const pipeline = useMemo')
    const pipelineEnd = dashboardClientSource.indexOf('const selectedApplicationEvents', pipelineStart)
    const pipelineBlock = dashboardClientSource.slice(pipelineStart, pipelineEnd)

    expect(pipelineBlock).toContain("'interview_invited'")
    expect(pipelineBlock).toContain("'trial_offered'")
    expect(pipelineBlock).not.toContain('.slice(0, 6)')
  })

  it('keeps recruitment drawer actions clear and status-aware', () => {
    expect(dashboardClientSource).toContain('function quickStatusActionsFor')
    expect(dashboardClientSource).toContain('function recruitmentNextActionHint')
    expect(dashboardClientSource).toContain('Next step')
    expect(dashboardClientSource).toContain('Shortlist candidate')
    expect(dashboardClientSource).toContain('Mark interviewed')
    expect(dashboardClientSource).toContain('Send interview booking link')
    expect(dashboardClientSource).toContain('Resend interview booking link')
    expect(dashboardClientSource).toContain('Send trial booking link')
    expect(dashboardClientSource).toContain('Save manual status')
    expect(dashboardClientSource).toContain('Re-score AI fit')
    expect(dashboardClientSource).toContain('Create employee invite')
    expect(dashboardClientSource).toContain("variant={selectedApplication.archived_at ? 'secondary' : 'danger'}")
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
