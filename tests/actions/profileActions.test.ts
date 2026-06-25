import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/app/actions/audit'
import { changePassword, exportProfileData, removeAvatar, updateProfile, uploadAvatar } from '@/app/actions/profile'

const mockedCreateClient = createClient as unknown as Mock
const mockedLogAuditEvent = logAuditEvent as unknown as Mock
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

  it('removes the current avatar file and clears the profile avatar', async () => {
    const profileMaybeSingle = vi.fn().mockResolvedValue({
      data: { avatar_url: 'avatars/user-1.png' },
      error: null,
    })
    const profileEq = vi.fn().mockReturnValue({ maybeSingle: profileMaybeSingle })
    const profileSelect = vi.fn().mockReturnValue({ eq: profileEq })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'user-1' }, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

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
          select: profileSelect,
          update,
        }
      }),
      storage: {
        from: vi.fn((bucket: string) => {
          if (bucket !== 'avatars') {
            throw new Error(`Unexpected bucket: ${bucket}`)
          }

          return { remove }
        }),
      },
    })

    const result = await removeAvatar()

    expect(result).toEqual({ success: true })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ avatar_url: null }))
    expect(remove).toHaveBeenCalledWith(['avatars/user-1.png'])
    expect(mockedLogAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'update',
      resource_type: 'profile',
      additional_info: { field: 'avatar_url', action: 'removed' },
    }))
  })

  it('changes password only after verifying the current password', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null })
    const updateUser = vi.fn().mockResolvedValue({ error: null })

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: 'user-1',
              email: 'manager@example.com',
            },
          },
          error: null,
        }),
        signInWithPassword,
        updateUser,
      },
    })

    const result = await changePassword({
      currentPassword: 'OldPassword1!',
      newPassword: 'NewPassword2!',
    })

    expect(result).toEqual({ success: true })
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'manager@example.com',
      password: 'OldPassword1!',
    })
    expect(updateUser).toHaveBeenCalledWith({ password: 'NewPassword2!' })
    expect(mockedLogAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'password_change',
      resource_type: 'profile',
    }))
  })

  it('rejects weak password changes before re-authenticating', async () => {
    const signInWithPassword = vi.fn()
    const updateUser = vi.fn()

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: 'user-1',
              email: 'manager@example.com',
            },
          },
          error: null,
        }),
        signInWithPassword,
        updateUser,
      },
    })

    const result = await changePassword({
      currentPassword: 'OldPassword1!',
      newPassword: 'password',
    })

    expect(result).toEqual({
      error: 'Password must include at least three of: uppercase, lowercase, number, symbol',
    })
    expect(signInWithPassword).not.toHaveBeenCalled()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('does not update the password when the current password is wrong', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ error: { message: 'invalid login' } })
    const updateUser = vi.fn()

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: 'user-1',
              email: 'manager@example.com',
            },
          },
          error: null,
        }),
        signInWithPassword,
        updateUser,
      },
    })

    const result = await changePassword({
      currentPassword: 'wrong-password',
      newPassword: 'NewPassword2!',
    })

    expect(result).toEqual({ error: 'Current password is incorrect' })
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('exports messages by linked customer id, not auth user id', async () => {
    const profileSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'user-1',
        email: 'guest@example.com',
        full_name: 'Guest User',
      },
      error: null,
    })
    const profileEq = vi.fn().mockReturnValue({ single: profileSingle })

    const customersIn = vi.fn().mockResolvedValue({
      data: [{ id: 'customer-1' }],
      error: null,
    })
    const messagesIn = vi.fn().mockResolvedValue({
      data: [{ id: 'message-1', customer_id: 'customer-1', body: 'Hello' }],
      error: null,
    })

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: 'user-1',
              email: 'guest@example.com',
            },
          },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnValue({ eq: profileEq }),
          }
        }
        if (table === 'customers') {
          return {
            select: vi.fn().mockReturnValue({ in: customersIn }),
          }
        }
        if (table === 'messages') {
          return {
            select: vi.fn().mockReturnValue({ in: messagesIn }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await exportProfileData()

    expect(result).toMatchObject({ success: true })
    if (!('content' in result)) throw new Error('Expected export content')
    const payload = JSON.parse(result.content)
    expect(payload.customerIds).toEqual(['customer-1'])
    expect(payload.messages).toEqual([{ id: 'message-1', customer_id: 'customer-1', body: 'Hello' }])
    expect(messagesIn).toHaveBeenCalledWith('customer_id', ['customer-1'])
    expect(messagesIn).not.toHaveBeenCalledWith('customer_id', ['user-1'])
  })

  it('fails the profile export when the messages query errors', async () => {
    const profileSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'user-1',
        email: 'guest@example.com',
      },
      error: null,
    })
    const profileEq = vi.fn().mockReturnValue({ single: profileSingle })

    const customersIn = vi.fn().mockResolvedValue({
      data: [{ id: 'customer-1' }],
      error: null,
    })
    const messagesIn = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'messages unavailable' },
    })

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: 'user-1',
              email: 'guest@example.com',
            },
          },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnValue({ eq: profileEq }),
          }
        }
        if (table === 'customers') {
          return {
            select: vi.fn().mockReturnValue({ in: customersIn }),
          }
        }
        if (table === 'messages') {
          return {
            select: vi.fn().mockReturnValue({ in: messagesIn }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await exportProfileData()

    expect(result).toEqual({ error: 'Failed to export messages' })
  })
})
