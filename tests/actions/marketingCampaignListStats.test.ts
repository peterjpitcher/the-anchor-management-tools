import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser } }) }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/services/marketing-campaigns', () => ({ getCampaignListStats: vi.fn() }))

import { checkUserPermission } from '@/app/actions/rbac'
import { getMarketingCampaignListStats } from '@/app/actions/marketing-campaigns'
import { getCampaignListStats } from '@/services/marketing-campaigns'

const ID_1 = '00000000-0000-4000-8000-000000000001'
const ID_2 = '00000000-0000-4000-8000-000000000002'

describe('getMarketingCampaignListStats', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'staff@example.test' } } })
    vi.mocked(checkUserPermission).mockResolvedValue(true)
    vi.mocked(getCampaignListStats).mockResolvedValue({})
  })

  it('authorises once with marketing view for the whole page', async () => {
    const result = await getMarketingCampaignListStats([ID_1, ID_2])

    expect(result).toEqual({ success: true, data: {} })
    expect(getUser).toHaveBeenCalledTimes(1)
    expect(checkUserPermission).toHaveBeenCalledTimes(1)
    expect(checkUserPermission).toHaveBeenCalledWith('marketing', 'view', 'user-1')
    expect(getCampaignListStats).toHaveBeenCalledWith([ID_1, ID_2])
  })

  it('refuses without marketing view and reads nothing', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false)
    expect(await getMarketingCampaignListStats([ID_1])).toEqual({ error: 'Insufficient permissions' })
    expect(getCampaignListStats).not.toHaveBeenCalled()
  })

  it('refuses a signed-out caller', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    expect(await getMarketingCampaignListStats([ID_1])).toEqual({ error: 'Unauthorized' })
    expect(getCampaignListStats).not.toHaveBeenCalled()
  })

  it('rejects ids that are not campaign ids, and more than a page of them', async () => {
    expect(await getMarketingCampaignListStats(['not-a-uuid'])).toEqual({ error: 'Invalid campaign ids' })
    expect(await getMarketingCampaignListStats(Array.from({ length: 201 }, () => ID_1))).toEqual({ error: 'Invalid campaign ids' })
    expect(getCampaignListStats).not.toHaveBeenCalled()
  })

  it('turns a failed read into an error rather than empty results', async () => {
    vi.mocked(getCampaignListStats).mockRejectedValue(new Error('Read failed'))
    expect(await getMarketingCampaignListStats([ID_1])).toEqual({ error: 'Read failed' })
  })
})
