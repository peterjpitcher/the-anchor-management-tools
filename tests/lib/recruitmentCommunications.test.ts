import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendEmail = vi.hoisted(() => vi.fn())
const sendSMS = vi.hoisted(() => vi.fn())
const draftRecruitmentEmail = vi.hoisted(() => vi.fn())

vi.mock('@/lib/email/emailService', () => ({
  sendEmail,
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS,
}))

vi.mock('@/lib/recruitment/ai', () => ({
  draftRecruitmentEmail,
}))

import {
  draftRecruitmentEmailForApplication,
  sendRecruitmentSms,
  sendRecruitmentTemplateEmail,
} from '@/lib/recruitment/communications'

function maybeSingleChain(result: { data: any; error: any }) {
  const chain: any = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  return chain
}

function insertUpdateChain(insertResult: { data: any; error: any } = { data: { id: 'comm-1' }, error: null }) {
  const chain: any = {}
  chain.insert = vi.fn(() => chain)
  chain.select = vi.fn(() => chain)
  chain.single = vi.fn().mockResolvedValue(insertResult)
  chain.update = vi.fn(() => chain)
  chain.eq = vi.fn().mockResolvedValue({ error: null })
  return chain
}

function mockSupabase(tables: Record<string, any>) {
  return {
    from: vi.fn((table: string) => {
      const value = tables[table]
      if (!value) {
        throw new Error(`Unexpected table: ${table}`)
      }
      return value
    }),
  } as any
}

const application = {
  id: 'application-1',
  candidate_id: 'candidate-1',
  ai_score: 72,
  ai_recommendation: 'review',
  ai_rationale: 'Good relevant experience.',
  ai_strengths: ['bar experience'],
  ai_concerns: ['internal concern that must not go to rejection drafts'],
  candidate: {
    id: 'candidate-1',
    first_name: 'Jane',
    last_name: 'Smith',
    email: 'jane@example.com',
    cv_summary: 'Two years of bar work.',
    provided_details: 'Available weekends.',
  },
  job_posting: {
    title: 'Bartender',
  },
}

describe('recruitment communications safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RECRUITMENT_FROM_EMAIL = 'peter@orangejelly.co.uk'
    process.env.RECRUITMENT_NOTIFICATION_EMAIL = 'manager@the-anchor.pub'
  })

  it('sends recruitment SMS without creating or linking customers', async () => {
    sendSMS.mockResolvedValue({ success: true, messageSid: 'SM1' })
    const communications = insertUpdateChain()
    const supabase = mockSupabase({
      recruitment_candidates: maybeSingleChain({
        data: {
          id: 'candidate-1',
          phone: '07700900123',
          phone_e164: '+447700900123',
          sms_consent: true,
        },
        error: null,
      }),
      recruitment_communications: communications,
    })

    const result = await sendRecruitmentSms('candidate-1', 'reminder', 'Reminder text', {
      applicationId: 'application-1',
    }, supabase)

    expect(result.success).toBe(true)
    expect(sendSMS).toHaveBeenCalledWith('+447700900123', 'Reminder text', expect.objectContaining({
      createCustomerIfMissing: false,
      allowTransactionalOverride: true,
      metadata: expect.objectContaining({
        recruitment_candidate_id: 'candidate-1',
        recruitment_application_id: 'application-1',
      }),
    }))
    expect(communications.insert).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'sms',
      candidate_id: 'candidate-1',
      application_id: 'application-1',
    }))
  })

  it('blocks recruitment SMS when separate SMS consent is missing', async () => {
    const supabase = mockSupabase({
      recruitment_candidates: maybeSingleChain({
        data: {
          id: 'candidate-1',
          phone_e164: '+447700900123',
          sms_consent: false,
        },
        error: null,
      }),
    })

    await expect(sendRecruitmentSms('candidate-1', 'reminder', 'Reminder text', {}, supabase))
      .rejects.toThrow('Candidate has not consented to recruitment SMS.')
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('blocks offer emails with missing deterministic offer terms', async () => {
    const supabase = mockSupabase({
      recruitment_applications: maybeSingleChain({ data: application, error: null }),
    })

    await expect(sendRecruitmentTemplateEmail('application-1', 'offer', {}, supabase))
      .rejects.toThrow('Missing required recruitment merge fields: offer_terms')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('does not pass internal AI concerns into rejection draft context', async () => {
    draftRecruitmentEmail.mockResolvedValue({
      runId: 'run-1',
      result: {
        subject: 'Your application',
        body: 'Thanks for applying.',
      },
    })

    const supabase = mockSupabase({
      recruitment_applications: maybeSingleChain({ data: application, error: null }),
      recruitment_email_templates: maybeSingleChain({
        data: {
          subject: 'Your application',
          body: 'Hi {{first_name}}, thanks for applying.',
        },
        error: null,
      }),
    })

    const result = await draftRecruitmentEmailForApplication('application-1', 'rejection', {}, supabase)

    expect(result.success).toBe(true)
    expect(draftRecruitmentEmail).toHaveBeenCalledWith(supabase, expect.objectContaining({
      type: 'rejection',
      context: expect.not.objectContaining({
        ai_concerns: expect.anything(),
      }),
    }))
  })
})
