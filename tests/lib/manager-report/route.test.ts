import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/cron/manager-weekly-report/route'

const mocks = vi.hoisted(() => ({ deliver: vi.fn(), alert: vi.fn() }))
vi.mock('@/lib/manager-report/delivery', () => ({ deliverManagerReport: mocks.deliver }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: mocks.alert }))

const authorised = () => new Request('https://example.test/api/cron/manager-weekly-report', { headers: { authorization: 'Bearer fixture-secret' } })

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'fixture-secret')
  mocks.deliver.mockReset()
  mocks.alert.mockReset()
  mocks.alert.mockResolvedValue(undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('manager report cron boundary', () => {
  it('rejects unauthorised requests and a forged cron header before delivery', async () => {
    const response = await GET(new Request('https://example.test/api/cron/manager-weekly-report', { headers: { 'x-vercel-cron': '1' } }))
    expect(response.status).toBe(401)
    expect(mocks.deliver).not.toHaveBeenCalled()
    expect(mocks.alert).not.toHaveBeenCalled()
  })

  it('returns an explicit failure and alerts once when delivery throws', async () => {
    mocks.deliver.mockRejectedValue(new Error('Missing configuration'))
    const response = await GET(authorised())
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ success: false })
    expect(mocks.alert).toHaveBeenCalledTimes(1)
    expect(mocks.alert).toHaveBeenCalledWith('manager-weekly-report', expect.any(Error), undefined)
  })

  it('returns delivery failure to the scheduler and alerts once', async () => {
    mocks.deliver.mockResolvedValue({ success: false, sent: 0, error: 'Fixture failure' })
    const response = await GET(authorised())
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ success: false, error: 'Fixture failure' })
    expect(mocks.alert).toHaveBeenCalledTimes(1)
  })

  it('keeps the failure visible when the alert itself fails', async () => {
    mocks.deliver.mockResolvedValue({ success: false, sent: 0, error: 'Fixture failure' })
    mocks.alert.mockRejectedValue(new Error('Alert transport down'))
    const response = await GET(authorised())
    expect(response.status).toBe(500)
  })

  it('does not alert on a normal send or while waiting for sections', async () => {
    mocks.deliver.mockResolvedValueOnce({ success: true, sent: 1 })
    expect((await GET(authorised())).status).toBe(200)
    mocks.deliver.mockResolvedValueOnce({ success: true, sent: 0, skipped: 'waiting_for_sections', notCheckedSections: ['events'] })
    expect((await GET(authorised())).status).toBe(200)
    expect(mocks.alert).not.toHaveBeenCalled()
  })

  it('alerts when the report went out with sections not checked, naming only the sections', async () => {
    mocks.deliver.mockResolvedValue({ success: true, sent: 1, notCheckedSections: ['cashing_up', 'events'] })
    expect((await GET(authorised())).status).toBe(200)
    expect(mocks.alert).toHaveBeenCalledWith('manager-weekly-report', expect.any(Error), { sections: ['cashing_up', 'events'] })
  })
})
