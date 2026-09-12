/**
 * A retried send must not rewrite a delivered row back to 'sent'.
 *
 * `recordEmailMessage` upserts on `resend_message_id`, and a retry the provider deduplicated
 * comes back with the same id. The upsert replaces the whole row, so a message that had
 * already reached 'delivered' (or worse, 'bounced') lost that and read as a fresh send.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const createAdminClient = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

type Harness = {
  upsert: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
}

function harnessFor(existingStatus: string | null | 'missing'): Harness {
  const upsertResult = { select: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'row-1' }, error: null }) }) }
  const upsert = vi.fn().mockReturnValue(upsertResult)
  const insert = vi.fn().mockReturnValue(upsertResult)

  createAdminClient.mockReturnValue({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: existingStatus === 'missing' ? null : { status: existingStatus },
            error: null,
          }),
        }),
      }),
      upsert,
      insert,
    })),
  })

  return { upsert, insert }
}

async function record(status: 'sent' | 'delivered' | 'failed', resendMessageId: string | null) {
  const { recordEmailMessage } = await import('@/lib/email/logging')
  return recordEmailMessage({
    toAddress: 'Guest@Example.com',
    status,
    resendMessageId,
    commType: 'table_booking_confirmation',
  })
}

describe('recordEmailMessage status progression', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('does not walk a delivered row back to sent', async () => {
    const harness = harnessFor('delivered')

    await record('sent', 'resend-1')

    const payload = harness.upsert.mock.calls[0][0]
    expect(payload).not.toHaveProperty('status')
    expect(payload).not.toHaveProperty('sent_at')
  })

  it('does not walk a bounced row back to sent', async () => {
    const harness = harnessFor('bounced')

    await record('sent', 'resend-1')

    expect(harness.upsert.mock.calls[0][0]).not.toHaveProperty('status')
  })

  it('still writes the status on a first send', async () => {
    const harness = harnessFor('missing')

    await record('sent', 'resend-1')

    const payload = harness.upsert.mock.calls[0][0]
    expect(payload.status).toBe('sent')
    expect(payload.sent_at).toBeTruthy()
  })

  it('still moves a sent row forward to delivered', async () => {
    const harness = harnessFor('sent')

    await record('delivered', 'resend-1')

    expect(harness.upsert.mock.calls[0][0].status).toBe('delivered')
  })

  it('lets a failure overwrite a queued row', async () => {
    const harness = harnessFor('queued')

    await record('failed', 'resend-1')

    const payload = harness.upsert.mock.calls[0][0]
    expect(payload.status).toBe('failed')
    expect(payload.failed_at).toBeTruthy()
  })

  it('inserts unchanged when the provider gave no id', async () => {
    const harness = harnessFor('missing')

    await record('sent', null)

    expect(harness.upsert).not.toHaveBeenCalled()
    expect(harness.insert.mock.calls[0][0].status).toBe('sent')
  })

  it('normalises the recipient address as before', async () => {
    const harness = harnessFor('missing')

    await record('sent', 'resend-1')

    expect(harness.upsert.mock.calls[0][0].to_address).toBe('guest@example.com')
  })
})
