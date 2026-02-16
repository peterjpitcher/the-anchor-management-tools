import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { removeProjectContact } from '@/app/actions/oj-projects/project-contacts'
import { disableWorkType, updateWorkType } from '@/app/actions/oj-projects/work-types'
import { disableRecurringCharge, updateRecurringCharge } from '@/app/actions/oj-projects/recurring-charges'
import { deleteProject, updateProject, updateProjectStatus } from '@/app/actions/oj-projects/projects'
import { deleteEntry, updateEntry } from '@/app/actions/oj-projects/entries'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock

describe('OJ project action mutation row-effect guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
  })

  it('returns project-contact-not-found when contact delete affects no rows', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'oj_project_contacts') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          delete: vi.fn().mockReturnValue({ eq }),
        }
      }),
    })

    const formData = new FormData()
    formData.set('id', 'project-contact-1')

    const result = await removeProjectContact(formData)

    expect(result).toEqual({ error: 'Project contact not found' })
  })

  it('returns work-type-not-found when disable update affects no rows', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'oj_work_types') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq }),
        }
      }),
    })

    const formData = new FormData()
    formData.set('id', 'work-type-1')

    const result = await disableWorkType(formData)

    expect(result).toEqual({ error: 'Work type not found' })
  })

  it('returns work-type-not-found when update affects no rows', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'oj_work_types') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq }),
        }
      }),
    })

    const formData = new FormData()
    formData.set('id', 'work-type-1')
    formData.set('name', 'Ops')
    formData.set('sort_order', '0')
    formData.set('is_active', 'true')

    const result = await updateWorkType(formData)

    expect(result).toEqual({ error: 'Work type not found' })
  })

  it('returns charge-not-found when recurring-charge disable update affects no rows', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'oj_vendor_recurring_charges') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq }),
        }
      }),
    })

    const formData = new FormData()
    formData.set('id', 'charge-1')

    const result = await disableRecurringCharge(formData)

    expect(result).toEqual({ error: 'Charge not found' })
  })

  it('returns charge-not-found when recurring-charge update affects no rows', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'oj_vendor_recurring_charges') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq }),
        }
      }),
    })

    const formData = new FormData()
    formData.set('id', 'charge-1')
    formData.set('vendor_id', '550e8400-e29b-41d4-a716-446655440000')
    formData.set('description', 'Retainer')
    formData.set('amount_ex_vat', '100')
    formData.set('vat_rate', '20')
    formData.set('is_active', 'true')
    formData.set('sort_order', '1')

    const result = await updateRecurringCharge(formData)

    expect(result).toEqual({ error: 'Charge not found' })
  })

  it('returns project-not-found when deleteProject delete affects no rows after entry precheck', async () => {
    const entriesEq = vi.fn().mockResolvedValue({ count: 0, error: null })

    const deleteMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const deleteSelect = vi.fn().mockReturnValue({ maybeSingle: deleteMaybeSingle })
    const deleteEq = vi.fn().mockReturnValue({ select: deleteSelect })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === 'oj_entries') {
          return {
            select: vi.fn().mockReturnValue({ eq: entriesEq }),
          }
        }

        if (table === 'oj_projects') {
          return {
            delete: vi.fn().mockReturnValue({ eq: deleteEq }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const formData = new FormData()
    formData.set('id', 'project-1')

    const result = await deleteProject(formData)

    expect(result).toEqual({ error: 'Project not found' })
  })

  it('returns project-not-found when status update affects no rows', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'oj_projects') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq }),
        }
      }),
    })

    const formData = new FormData()
    formData.set('id', 'project-1')
    formData.set('status', 'active')

    const result = await updateProjectStatus(formData)

    expect(result).toEqual({ error: 'Project not found' })
  })

  it('returns project-not-found when project update affects no rows', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'oj_projects') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq }),
        }
      }),
    })

    const formData = new FormData()
    formData.set('id', '550e8400-e29b-41d4-a716-446655440001')
    formData.set('vendor_id', '550e8400-e29b-41d4-a716-446655440000')
    formData.set('project_name', 'Website refresh')
    formData.set('status', 'active')

    const result = await updateProject(formData)

    expect(result).toEqual({ error: 'Project not found' })
  })

  it('returns entry-not-found when deleteEntry delete affects no rows after prefetch', async () => {
    const prefetchSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'entry-1',
        status: 'unbilled',
      },
      error: null,
    })
    const prefetchEq = vi.fn().mockReturnValue({ single: prefetchSingle })

    const deleteMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const deleteSelect = vi.fn().mockReturnValue({ maybeSingle: deleteMaybeSingle })
    const deleteEq = vi.fn().mockReturnValue({ select: deleteSelect })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'oj_entries') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: prefetchEq }),
          delete: vi.fn().mockReturnValue({ eq: deleteEq }),
        }
      }),
    })

    const formData = new FormData()
    formData.set('id', 'entry-1')

    const result = await deleteEntry(formData)

    expect(result).toEqual({ error: 'Entry not found' })
  })

  it('returns entry-not-found when mileage entry update affects no rows', async () => {
    const entryFetchSingle = vi.fn().mockResolvedValue({
      data: { id: '550e8400-e29b-41d4-a716-446655440010', status: 'unbilled' },
      error: null,
    })
    const entryFetchEq = vi.fn().mockReturnValue({ single: entryFetchSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    const projectSingle = vi.fn().mockResolvedValue({
      data: { id: '550e8400-e29b-41d4-a716-446655440200', vendor_id: '550e8400-e29b-41d4-a716-446655440000', status: 'active' },
      error: null,
    })
    const projectEq = vi.fn().mockReturnValue({ single: projectSingle })

    const settingsMaybeSingle = vi.fn().mockResolvedValue({
      data: { hourly_rate_ex_vat: 90, vat_rate: 20, mileage_rate: 0.45 },
      error: null,
    })
    const settingsEq = vi.fn().mockReturnValue({ maybeSingle: settingsMaybeSingle })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === 'oj_entries') {
          return {
            select: vi.fn().mockReturnValue({ eq: entryFetchEq }),
            update: vi.fn().mockReturnValue({ eq: updateEq }),
          }
        }

        if (table === 'oj_projects') {
          return {
            select: vi.fn().mockReturnValue({ eq: projectEq }),
          }
        }

        if (table === 'oj_vendor_billing_settings') {
          return {
            select: vi.fn().mockReturnValue({ eq: settingsEq }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const formData = new FormData()
    formData.set('id', '550e8400-e29b-41d4-a716-446655440010')
    formData.set('entry_type', 'mileage')
    formData.set('vendor_id', '550e8400-e29b-41d4-a716-446655440000')
    formData.set('project_id', '550e8400-e29b-41d4-a716-446655440200')
    formData.set('entry_date', '2026-02-14')
    formData.set('miles', '12.5')
    formData.set('billable', 'true')

    const result = await updateEntry(formData)

    expect(result).toEqual({ error: 'Entry not found' })
  })
})
