import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { BusinessHoursService } from '@/services/business-hours'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

describe('BusinessHoursService reliability guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails closed when existing special-hours lookup errors during range create', async () => {
    const inQuery = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'connection lost' },
    })

    const client = {
      from: vi.fn((table: string) => {
        if (table !== 'special_hours') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ in: inQuery }),
        }
      }),
      rpc: vi.fn(),
    }

    mockedCreateAdminClient.mockReturnValue(client)

    const formData = new FormData()
    formData.set('date', '2026-02-14')
    formData.set('end_date', '2026-02-14')
    formData.set('opens', '09:00')
    formData.set('closes', '17:00')
    formData.set('kitchen_opens', '10:00')
    formData.set('kitchen_closes', '16:00')
    formData.set('is_closed', 'false')
    formData.set('is_kitchen_closed', 'false')

    await expect(BusinessHoursService.createSpecialHours(formData)).rejects.toThrow(
      'Failed to validate existing special hours'
    )
  })

  it('returns load error (not not-found) when delete prefetch query fails', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'database timeout' },
    })
    const eq = vi.fn().mockReturnValue({ maybeSingle })

    const client = {
      from: vi.fn((table: string) => {
        if (table !== 'special_hours') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq }),
        }
      }),
      rpc: vi.fn(),
    }

    mockedCreateAdminClient.mockReturnValue(client)

    await expect(BusinessHoursService.deleteSpecialHours('special-1')).rejects.toThrow(
      'Failed to load special hours'
    )
  })

  it('throws not-found when service status override delete affects no rows after prefetch', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'override-1',
        service_code: 'sunday_lunch',
        start_date: '2026-02-14',
        end_date: '2026-02-14',
        is_enabled: false,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })

    const deleteMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const deleteSelect = vi.fn().mockReturnValue({ maybeSingle: deleteMaybeSingle })
    const deleteEq = vi.fn().mockReturnValue({ select: deleteSelect })

    const serviceStatusSingle = vi.fn().mockResolvedValue({
      data: { is_enabled: true },
      error: null,
    })
    const serviceStatusEq = vi.fn().mockReturnValue({ single: serviceStatusSingle })

    const slotLte = vi.fn().mockResolvedValue({ error: null })
    const slotGte = vi.fn().mockReturnValue({ lte: slotLte })
    const slotEq = vi.fn().mockReturnValue({ gte: slotGte })

    const client = {
      from: vi.fn((table: string) => {
        if (table === 'service_status_overrides') {
          return {
            select: vi.fn().mockReturnValue({ eq: fetchEq }),
            delete: vi.fn().mockReturnValue({ eq: deleteEq }),
          }
        }

        if (table === 'service_statuses') {
          return {
            select: vi.fn().mockReturnValue({ eq: serviceStatusEq }),
          }
        }

        if (table === 'service_slots') {
          return {
            update: vi.fn().mockReturnValue({ eq: slotEq }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc: vi.fn().mockResolvedValue({ error: null }),
    }

    mockedCreateAdminClient.mockReturnValue(client)

    await expect(BusinessHoursService.deleteServiceStatusOverride('override-1')).rejects.toThrow(
      'Override not found'
    )
  })

  it('throws service-status-not-found when update row effect is empty after prefetch', async () => {
    const fetchStatusMaybeSingle = vi.fn().mockResolvedValue({
      data: { service_code: 'sunday_lunch', is_enabled: true },
      error: null,
    })
    const fetchStatusEq = vi.fn().mockReturnValue({ maybeSingle: fetchStatusMaybeSingle })

    const updateStatusMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const updateStatusSelect = vi.fn().mockReturnValue({ maybeSingle: updateStatusMaybeSingle })
    const updateStatusEq = vi.fn().mockReturnValue({ select: updateStatusSelect })

    const client = {
      from: vi.fn((table: string) => {
        if (table !== 'service_statuses') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchStatusEq }),
          update: vi.fn().mockReturnValue({ eq: updateStatusEq }),
        }
      }),
      rpc: vi.fn(),
    }

    mockedCreateAdminClient.mockReturnValue(client)

    await expect(
      BusinessHoursService.updateServiceStatus(
        'sunday_lunch',
        { is_enabled: false, message: null },
        'user-1'
      )
    ).rejects.toThrow('Service status not found')
  })

  it('throws when sunday lunch slot update fails during service-status update', async () => {
    const fetchStatusMaybeSingle = vi.fn().mockResolvedValue({
      data: { service_code: 'sunday_lunch', is_enabled: true },
      error: null,
    })
    const fetchStatusEq = vi.fn().mockReturnValue({ maybeSingle: fetchStatusMaybeSingle })

    const updateStatusMaybeSingle = vi.fn().mockResolvedValue({
      data: { service_code: 'sunday_lunch', is_enabled: false },
      error: null,
    })
    const updateStatusSelect = vi.fn().mockReturnValue({ maybeSingle: updateStatusMaybeSingle })
    const updateStatusEq = vi.fn().mockReturnValue({ select: updateStatusSelect })

    const slotGte = vi.fn().mockResolvedValue({
      error: { message: 'slot write failed' },
    })
    const slotEq = vi.fn().mockReturnValue({ gte: slotGte })

    const client = {
      from: vi.fn((table: string) => {
        if (table === 'service_statuses') {
          return {
            select: vi.fn().mockReturnValue({ eq: fetchStatusEq }),
            update: vi.fn().mockReturnValue({ eq: updateStatusEq }),
          }
        }

        if (table === 'service_slots') {
          return {
            update: vi.fn().mockReturnValue({ eq: slotEq }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc: vi.fn(),
    }

    mockedCreateAdminClient.mockReturnValue(client)

    await expect(
      BusinessHoursService.updateServiceStatus(
        'sunday_lunch',
        { is_enabled: false, message: null },
        'user-1'
      )
    ).rejects.toThrow('Failed to apply service slot update')
  })

  it('throws special-hours-not-found when update row effect is empty after prefetch', async () => {
    const loadMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'special-1',
        date: '2026-02-14',
        opens: '09:00',
        closes: '17:00',
        kitchen_opens: '10:00',
        kitchen_closes: '16:00',
        is_closed: false,
        is_kitchen_closed: false,
        note: null,
      },
      error: null,
    })
    const loadEq = vi.fn().mockReturnValue({ maybeSingle: loadMaybeSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    const client = {
      from: vi.fn((table: string) => {
        if (table !== 'special_hours') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: loadEq }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
      rpc: vi.fn(),
    }

    mockedCreateAdminClient.mockReturnValue(client)

    const formData = new FormData()
    formData.set('date', '2026-02-14')
    formData.set('opens', '09:00')
    formData.set('closes', '17:00')
    formData.set('kitchen_opens', '10:00')
    formData.set('kitchen_closes', '16:00')
    formData.set('is_closed', 'false')
    formData.set('is_kitchen_closed', 'false')
    formData.set('note', '')

    await expect(BusinessHoursService.updateSpecialHours('special-1', formData)).rejects.toThrow(
      'Special hours not found'
    )
  })
})
