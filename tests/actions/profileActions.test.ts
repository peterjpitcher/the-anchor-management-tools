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
const validPngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d,
])

function testFile(content: Uint8Array | string, name: string, type: string) {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
  const file = new File([bytes], name, { type })
  Object.defineProperty(file, 'arrayBuffer', {
    value: vi.fn(async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  })
  return file
}

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
    formData.set('avatar', testFile(validPngBytes, 'avatar.png', 'image/png'))

    const result = await uploadAvatar(formData)

    expect(result).toEqual({ error: 'Profile not found' })
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('rejects SVG avatar uploads before storage', async () => {
    const upload = vi.fn()

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
      storage: {
        from: vi.fn(() => ({ upload })),
      },
    })

    const formData = new FormData()
    formData.set('avatar', testFile('<svg></svg>', 'avatar.svg', 'image/svg+xml'))

    const result = await uploadAvatar(formData)

    expect(result).toEqual({ error: 'Avatar must be a JPG, PNG, or WebP image' })
    expect(upload).not.toHaveBeenCalled()
  })

  it('rejects files whose bytes do not match the claimed avatar MIME type', async () => {
    const upload = vi.fn()

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
      storage: {
        from: vi.fn(() => ({ upload })),
      },
    })

    const formData = new FormData()
    formData.set('avatar', testFile('<svg></svg>', 'avatar.png', 'image/png'))

    const result = await uploadAvatar(formData)

    expect(result).toEqual({ error: 'Avatar file content does not match the selected image type' })
    expect(upload).not.toHaveBeenCalled()
  })

  it('rejects oversized avatar uploads before storage', async () => {
    const upload = vi.fn()

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
      storage: {
        from: vi.fn(() => ({ upload })),
      },
    })

    const oversized = new Uint8Array(5 * 1024 * 1024 + 1)
    oversized.set(validPngBytes, 0)
    const formData = new FormData()
    formData.set('avatar', new File([oversized], 'avatar.png', { type: 'image/png' }))

    const result = await uploadAvatar(formData)

    expect(result).toEqual({ error: 'Avatar must be 5 MB or smaller' })
    expect(upload).not.toHaveBeenCalled()
  })
})
