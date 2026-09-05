import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/cron/manager-weekly-report/route'

const mocks = vi.hoisted(() => ({ deliver: vi.fn() }))
vi.mock('@/lib/manager-report/delivery', () => ({ deliverManagerReport: mocks.deliver }))

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'fixture-secret')
  mocks.deliver.mockReset()
})

describe('manager report cron boundary', () => {
  it('rejects unauthorised requests and a forged cron header before delivery', async () => {
    const response = await GET(new Request('https://example.test/api/cron/manager-weekly-report', { headers: { 'x-vercel-cron': '1' } }))
    expect(response.status).toBe(401)
    expect(mocks.deliver).not.toHaveBeenCalled()
  })
  it('returns an explicit failure when dependency setup throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.deliver.mockRejectedValue(new Error('Missing configuration'))
    const response = await GET(new Request('https://example.test/api/cron/manager-weekly-report', { headers: { authorization: 'Bearer fixture-secret' } }))
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ success: false })
    errorSpy.mockRestore()
  })
  it('returns delivery failure to the scheduler so it is visible and retryable', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.deliver.mockResolvedValue({ success: false, sent: 0, error: 'Fixture failure' })
    const response = await GET(new Request('https://example.test/api/cron/manager-weekly-report', { headers: { authorization: 'Bearer fixture-secret' } }))
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ success: false, error: 'Fixture failure' })
    errorSpy.mockRestore()
  })
})
