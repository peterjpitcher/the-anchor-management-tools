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
  retryRecruitmentCommunication,
  sendRecruitmentApplicationReceivedEmail,
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

function retryCommunicationChain(original: any, insertResult: { data: any; error: any } = { data: { id: 'comm-retry' }, error: null }) {
  const chain: any = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: original, error: null })
  chain.insert = vi.fn(() => chain)
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
  cover_note: 'I enjoy busy customer-facing work.',
  source: 'website',
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
    application_closing_date: '2026-07-31',
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

  it('sends a warm application received email from Peter', async () => {
    sendEmail.mockResolvedValue({ success: true, messageId: 'email-1' })
    const communications = insertUpdateChain()
    const supabase = mockSupabase({
      recruitment_applications: maybeSingleChain({ data: application, error: null }),
      recruitment_communications: communications,
    })

    const result = await sendRecruitmentApplicationReceivedEmail('application-1', supabase)

    expect(result.success).toBe(true)
    expect(communications.insert).toHaveBeenCalledWith(expect.objectContaining({
      application_id: 'application-1',
      candidate_id: 'candidate-1',
      type: 'application_received',
      channel: 'email',
      idempotency_key: 'recruitment_application_received:application-1',
    }))
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'jane@example.com',
      from: 'peter@orangejelly.co.uk',
      replyTo: 'peter@orangejelly.co.uk',
      subject: 'Thank you for applying to The Anchor',
      text: expect.stringContaining('Thank you for applying for Bartender.'),
      commType: 'recruitment_application_received',
    }))
    expect(sendEmail.mock.calls[0][0].text).toContain('Best,\nPeter')
    expect(sendEmail.mock.calls[0][0].text).toContain('Applications for this role close on 31 July 2026.')
  })

  it('retries communications by creating a new linked row', async () => {
    sendEmail.mockResolvedValue({ success: true, messageId: 'email-retry-1' })
    const communications = retryCommunicationChain({
      id: 'comm-original',
      application_id: 'application-1',
      candidate_id: 'candidate-1',
      type: 'rejection',
      channel: 'email',
      subject: 'Your application',
      final_body: 'Thanks again.',
      was_ai_assisted: false,
      ai_run_id: null,
      provider: 'email_service',
      metadata: { previous_error: 'temporary failure' },
      candidate: application.candidate,
    })
    const supabase = mockSupabase({
      recruitment_communications: communications,
    })

    const result = await retryRecruitmentCommunication('comm-original', 'user-1', supabase)

    expect(result).toMatchObject({
      success: true,
      communicationId: 'comm-retry',
      retryOfCommunicationId: 'comm-original',
    })
    expect(communications.insert).toHaveBeenCalledWith(expect.objectContaining({
      delivery_status: 'queued',
      metadata: expect.objectContaining({
        retry_of_communication_id: 'comm-original',
      }),
    }))
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'jane@example.com',
      subject: 'Your application',
      text: 'Thanks again.',
      metadata: expect.objectContaining({
        communication_id: 'comm-retry',
        retry_of_communication_id: 'comm-original',
      }),
    }))
  })

  it.each(['rejection', 'already_considered'] as const)('does not pass internal AI details into %s draft context', async (type) => {
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
          body: 'Hi {{first_name}}, thanks for applying for {{role_title}}.',
        },
        error: null,
      }),
    })

    const result = await draftRecruitmentEmailForApplication('application-1', type, {}, supabase)

    expect(result.success).toBe(true)
    const context = draftRecruitmentEmail.mock.calls[0][1].context
    expect(context).not.toHaveProperty('ai_score')
    expect(context).not.toHaveProperty('ai_recommendation')
    expect(context).not.toHaveProperty('ai_rationale')
    expect(context).not.toHaveProperty('ai_concerns')
    expect(context).toMatchObject({
      public_positive_signals: expect.arrayContaining([
        'Two years of bar work.',
        'Available weekends.',
        'I enjoy busy customer-facing work.',
        'bar experience',
      ]),
    })
  })
})
