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
  return chain
}

function listChain(result: { data: any; error: any }) {
  const chain: any = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.is = vi.fn(() => chain)
  chain.gt = vi.fn(() => chain)
  chain.order = vi.fn().mockResolvedValue(result)
  chain.limit = vi.fn().mockResolvedValue(result)
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

  it('sends reviewed recruitment emails from Peter through Microsoft Graph by default', async () => {
    delete process.env.RECRUITMENT_FROM_EMAIL
    sendEmail.mockResolvedValue({ success: true, messageId: 'email-1' })
    const communications = insertUpdateChain()
    const supabase = mockSupabase({
      recruitment_applications: maybeSingleChain({ data: application, error: null }),
      recruitment_email_templates: maybeSingleChain({ data: null, error: null }),
      recruitment_communications: communications,
    })

    const result = await sendRecruitmentTemplateEmail('application-1', 'rejection', {
      subjectOverride: 'Your application to The Anchor',
      bodyOverride: 'Hi {{first_name}}, thank you for applying for {{role_title}}.',
    }, supabase)

    expect(result.success).toBe(true)
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'jane@example.com',
      provider: 'graph',
      from: 'peter@orangejelly.co.uk',
      graphSender: 'peter@orangejelly.co.uk',
      replyTo: 'peter@orangejelly.co.uk',
      commType: 'recruitment_rejection',
    }))
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
      provider: 'graph',
      from: 'peter@orangejelly.co.uk',
      graphSender: 'peter@orangejelly.co.uk',
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
      provider: 'graph',
      graphSender: 'peter@orangejelly.co.uk',
      subject: 'Your application',
      text: 'Thanks again.',
      metadata: expect.objectContaining({
        communication_id: 'comm-retry',
        retry_of_communication_id: 'comm-original',
      }),
    }))
  })

  it('adds open schedule times to interview invite drafts', async () => {
    draftRecruitmentEmail.mockResolvedValue({
      runId: 'run-1',
      result: {
        subject: 'Interview invitation - The Anchor',
        body: 'Hi {{first_name}},\n\nThank you for applying for {{role_title}}. We would like to invite you for an interview.\n\nPlease let us know your preferred time from the following options:\n- Wednesday, 1 July 2026, 12:00-13:00\n- Wednesday, 1 July 2026, 13:00-14:00\n- Wednesday, 1 July 2026, 14:00-15:00\n- Wednesday, 1 July 2026, 15:00-16:00\n\nPlease bring proof of your right to work in the UK.\n\nBest,\nThe Anchor',
      },
    })

    const slots = listChain({
      data: [
        {
          starts_at: '2026-07-01T11:00:00.000Z',
          ends_at: '2026-07-01T12:00:00.000Z',
          timezone: 'Europe/London',
        },
        {
          starts_at: '2026-07-01T12:00:00.000Z',
          ends_at: '2026-07-01T13:00:00.000Z',
          timezone: 'Europe/London',
        },
        {
          starts_at: '2026-07-01T13:00:00.000Z',
          ends_at: '2026-07-01T14:00:00.000Z',
          timezone: 'Europe/London',
        },
        {
          starts_at: '2026-07-01T14:00:00.000Z',
          ends_at: '2026-07-01T15:00:00.000Z',
          timezone: 'Europe/London',
        },
        {
          starts_at: '2026-07-02T11:00:00.000Z',
          ends_at: '2026-07-02T15:00:00.000Z',
          timezone: 'Europe/London',
        },
      ],
      error: null,
    })
    const supabase = mockSupabase({
      recruitment_applications: maybeSingleChain({ data: application, error: null }),
      recruitment_appointment_slots: slots,
      recruitment_email_templates: maybeSingleChain({
        data: {
          subject: 'Interview invitation - The Anchor',
          body: 'Hi {{first_name}}, choose a time here: {{booking_link}}',
        },
        error: null,
      }),
    })

    const result = await draftRecruitmentEmailForApplication('application-1', 'interview_invite', {}, supabase)

    expect(result.success).toBe(true)
    expect(slots.eq).toHaveBeenCalledWith('type', 'interview')
    expect(slots.limit).not.toHaveBeenCalled()
    expect(result.body).toContain('available interview times:')
    expect(result.body).toContain('Wednesday, 1 July 2026 12pm to 4pm')
    expect(result.body).toContain('Thursday, 2 July 2026 12pm to 4pm')
    expect(result.body).toContain('The interview is expected to be no more than 1 hour.')
    expect(result.body).not.toContain('12:00-13:00')
    const context = draftRecruitmentEmail.mock.calls[0][1].context
    expect(context.available_times).toContain('Wednesday, 1 July 2026 12pm to 4pm')
  })

  it('adds open trial shift times to trial invite drafts', async () => {
    draftRecruitmentEmail.mockResolvedValue({
      runId: 'run-1',
      result: {
        subject: 'Trial shift invitation - The Anchor',
        body: 'Hi {{first_name}},\n\nWe would like to invite you for a trial shift.\n\nPlease bring proof of your right to work in the UK.\n\nBest,\nThe Anchor',
      },
    })

    const slots = listChain({
      data: [
        {
          starts_at: '2099-01-07T17:00:00.000Z',
          ends_at: '2099-01-07T19:00:00.000Z',
          timezone: 'Europe/London',
        },
      ],
      error: null,
    })
    const supabase = mockSupabase({
      recruitment_applications: maybeSingleChain({ data: application, error: null }),
      recruitment_appointment_slots: slots,
      recruitment_email_templates: maybeSingleChain({
        data: {
          subject: 'Trial shift invitation - The Anchor',
          body: 'Hi {{first_name}}, choose a time here: {{booking_link}}',
        },
        error: null,
      }),
    })

    const result = await draftRecruitmentEmailForApplication('application-1', 'trial_invite', {}, supabase)

    expect(result.success).toBe(true)
    expect(slots.eq).toHaveBeenCalledWith('type', 'trial_shift')
    expect(result.body).toContain('available trial shift times:')
    expect(result.body).toContain('5pm to 7pm')
    expect(result.body).toContain('The trial shift is expected to be 2 hours')
    expect(result.body).toContain('briefing before and a short debrief after')
    expect(result.body).toContain('Billy, the General Manager')
  })

  it('allows reviewed interview invite emails with literal slot times and no booking link', async () => {
    sendEmail.mockResolvedValue({ success: true, messageId: 'email-1' })
    const communications = insertUpdateChain()
    const supabase = mockSupabase({
      recruitment_applications: maybeSingleChain({ data: application, error: null }),
      recruitment_email_templates: maybeSingleChain({ data: null, error: null }),
      recruitment_communications: communications,
    })

    const result = await sendRecruitmentTemplateEmail('application-1', 'interview_invite', {
      subjectOverride: 'Interview invitation - The Anchor',
      bodyOverride: 'Hi Jane,\n\nAvailable interview times:\n- Monday 5 January 2099, 18:00-18:30',
    }, supabase)

    expect(result.success).toBe(true)
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'jane@example.com',
      text: expect.stringContaining('18:00-18:30'),
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
