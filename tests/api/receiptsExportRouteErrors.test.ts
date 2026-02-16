import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { GET } from '@/app/api/receipts/export/route'

describe('receipts export route error payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a generic 500 payload when an unexpected error is thrown', async () => {
    ;(checkUserPermission as unknown as vi.Mock).mockRejectedValue(
      new Error('sensitive permission backend diagnostics')
    )

    const request = new Request('http://localhost/api/receipts/export?year=2026&quarter=1')
    const response = await GET(request as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Failed to generate receipts export.' })
    expect('details' in payload).toBe(false)
  })
})
