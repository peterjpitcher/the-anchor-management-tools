import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { updateProfile, uploadAvatar } from '@/app/actions/profile'

const mockedCreateClient = createClient as unknown as Mock

describe('Profile action mutation guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns profile-not-found when updateProfile affects no rows', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: 'user-1',
            },
          },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table !== 'profiles') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq }),
        }
      }),
    })

    const result = await updateProfile({ fullName: 'Taylor Ops' })

    expect(result).toEqual({ error: 'Profile not found' })
  })

  it('removes uploaded avatar and returns profile-not-found when avatar update affects no rows', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })

    const upload = vi.fn().mockResolvedValue({ error: null })
    const remove = vi.fn().mockResolvedValue({ error: null })

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: 'user-1',
            },
          },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table !== 'profiles') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq }),
        }
      }),
      storage: {
        from: vi.fn((bucket: string) => {
          if (bucket !== 'avatars') {
            throw new Error(`Unexpected bucket: ${bucket}`)
          }

          return {
            upload,
            remove,
          }
        }),
      },
    })

    const formData = new FormData()
    formData.set('avatar', new File(['avatar'], 'avatar.png', { type: 'image/png' }))

    const result = await uploadAvatar(formData)

    expect(result).toEqual({ error: 'Profile not found' })
    expect(remove).toHaveBeenCalledTimes(1)
  })
})
