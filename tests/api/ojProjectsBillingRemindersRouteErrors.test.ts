import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/microsoft-graph', () => ({
  isGraphConfigured: vi.fn(),
  sendInternalReminder: vi.fn(),
}))

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn(),
  computeIdempotencyRequestHash: vi.fn(),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { isGraphConfigured, sendInternalReminder } from '@/lib/microsoft-graph'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { GET } from '@/app/api/cron/oj-projects-billing-reminders/route'

describe('oj projects billing reminders route error payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-31T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns generic send failure payload when reminder dispatch fails', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({})
    ;(isGraphConfigured as unknown as vi.Mock).mockReturnValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-1')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(sendInternalReminder as unknown as vi.Mock).mockResolvedValue({
      success: false,
      error: 'sensitive graph diagnostics',
    })
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)

    const response = await GET(new Request('http://localhost/api/cron/oj-projects-billing-reminders'))
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ sent: false, error: 'Failed to send reminder' })
    expect(releaseIdempotencyClaim).toHaveBeenCalledTimes(1)
  })
})

