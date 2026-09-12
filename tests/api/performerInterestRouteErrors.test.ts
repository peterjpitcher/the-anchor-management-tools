/**
 * The performer-interest route is retired.
 *
 * Open mic nights are discontinued, and nothing has posted here since 11 August 2026. The
 * route was still accepting a performer's name, phone number, email and act description, and
 * still replying with a confirmation that promised "we'll be in touch when we're booking
 * acts" and gave a start time for a night that no longer runs.
 *
 * This suite used to test the fail-closed guards around the rate-limit lookup. Those guards
 * have gone with the code they protected: there is nothing left to look up, insert, or email.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(),
  createApiResponse: vi.fn((data: unknown, status = 200) =>
    Response.json({ success: true, data }, { status })
  ),
  createErrorResponse: vi.fn((error: string, code: string, status = 400) =>
    Response.json({ success: false, error, code }, { status })
  ),
  createCorsPreflightResponse: vi.fn(() => new Response(null, { status: 204 })),
}))

const sendEmail = vi.hoisted(() => vi.fn())
vi.mock('@/lib/email/emailService', () => ({ sendEmail }))

const createAdminClient = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

import { withApiAuth } from '@/lib/api/auth'
import { POST } from '@/app/api/external/performer-interest/route'

function submission() {
  return new Request('http://localhost/api/external/performer-interest', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    body: JSON.stringify({
      fullName: 'Pat Example',
      email: 'pat@example.com',
      phone: '+447700900123',
      bio: 'Singer songwriter',
      consentDataStorage: true,
    }),
  })
}

describe('retired performer-interest route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('answers 410 Gone and says why', async () => {
    const response = await POST(submission() as any)
    const payload = await response.json()

    expect(response.status).toBe(410)
    expect(payload.code).toBe('ENDPOINT_RETIRED')
    expect(payload.error).toContain('Open mic nights are no longer running')
    // A guest who reaches a closed form still needs a way to reach a person.
    expect(payload.error).toContain('01753 682707')
  })

  it('stores nothing and emails nobody', async () => {
    await POST(submission() as any)

    expect(createAdminClient).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('no longer promises open mic nights', async () => {
    const payload = await (await POST(submission() as any)).json()

    expect(JSON.stringify(payload).toLowerCase()).not.toContain('booking acts')
    expect(JSON.stringify(payload)).not.toContain('8pm')
  })

  it('does not read the submitted body, so retiring the form records nothing', async () => {
    const request = submission()
    await POST(request as any)

    // Untouched: the route never asked for it.
    expect(request.bodyUsed).toBe(false)
    expect(withApiAuth).not.toHaveBeenCalled()
  })
})
