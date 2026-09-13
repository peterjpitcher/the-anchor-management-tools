import { beforeEach, describe, expect, it, vi } from 'vitest'

const authorizeCronRequestMock = vi.fn()
const cleanupStaleMaintenancePhotoUploadsMock = vi.fn()

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: (request: unknown) => authorizeCronRequestMock(request),
}))

vi.mock('@/app/actions/maintenance-photos', () => ({
  cleanupStaleMaintenancePhotoUploads: () => cleanupStaleMaintenancePhotoUploadsMock(),
}))

import { GET } from '@/app/api/cron/maintenance-photo-cleanup/route'

function cronRequest() {
  return new Request('http://localhost/api/cron/maintenance-photo-cleanup')
}

describe('/api/cron/maintenance-photo-cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    authorizeCronRequestMock.mockReturnValue({ authorized: true })
  })

  it('rejects an unauthorised request with 401 and does no work', async () => {
    authorizeCronRequestMock.mockReturnValue({
      authorized: false,
      reason: 'Missing or invalid cron credentials',
    })

    const response = await GET(cronRequest())
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
    expect(cleanupStaleMaintenancePhotoUploadsMock).not.toHaveBeenCalled()
  })

  it('returns the sweep summary on a clean run', async () => {
    cleanupStaleMaintenancePhotoUploadsMock.mockResolvedValue({
      success: true,
      correlationId: 'run-1',
      examined: 7,
      cleaned: 7,
      orphanedObjects: 0,
    })

    const response = await GET(cronRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(cleanupStaleMaintenancePhotoUploadsMock).toHaveBeenCalledTimes(1)
    expect(body).toMatchObject({
      success: true,
      correlationId: 'run-1',
      examined: 7,
      cleaned: 7,
      orphanedObjects: 0,
    })
    expect(typeof body.timestamp).toBe('string')
  })

  it('reports objects that could not be removed rather than swallowing them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    cleanupStaleMaintenancePhotoUploadsMock.mockResolvedValue({
      success: true,
      correlationId: 'run-2',
      examined: 5,
      cleaned: 3,
      orphanedObjects: 2,
    })

    const response = await GET(cronRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.orphanedObjects).toBe(2)
    expect(body.cleaned).toBe(3)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('run-2'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('2 storage object(s)'))
  })

  it('stays quiet about orphans when there are none', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    cleanupStaleMaintenancePhotoUploadsMock.mockResolvedValue({
      success: true,
      correlationId: 'run-3',
      examined: 0,
      cleaned: 0,
      orphanedObjects: 0,
    })

    const response = await GET(cronRequest())

    expect(response.status).toBe(200)
    expect(warn).not.toHaveBeenCalled()
  })

  it('fails loudly with a non-200 when the sweep reports an error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    cleanupStaleMaintenancePhotoUploadsMock.mockResolvedValue({
      error: 'The photo cleanup could not run.',
    })

    const response = await GET(cronRequest())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'The photo cleanup could not run.' })
    expect(error).toHaveBeenCalled()
  })

  it('fails loudly with a non-200 when the sweep throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    cleanupStaleMaintenancePhotoUploadsMock.mockRejectedValue(new Error('storage unreachable'))

    const response = await GET(cronRequest())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Maintenance photo cleanup failed' })
    expect(error).toHaveBeenCalled()
  })

  it('is scheduled daily in vercel.json', async () => {
    const { default: vercelConfig } = await import('../../vercel.json')
    const entries = (vercelConfig as { crons: Array<{ path: string; schedule: string }> }).crons.filter(
      (cron) => cron.path === '/api/cron/maintenance-photo-cleanup'
    )

    expect(entries).toHaveLength(1)
    expect(entries[0].schedule).toBe('40 3 * * *')
  })
})
