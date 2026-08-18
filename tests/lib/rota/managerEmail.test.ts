import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveRotaManagerEmail } from '@/lib/rota/manager-email'
import type { createAdminClient } from '@/lib/supabase/admin'

type SettingResponse = {
  data: { value: unknown } | null
  error: { message: string } | null
}

function fakeClient(response: SettingResponse) {
  const maybeSingle = vi.fn().mockResolvedValue(response)
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))

  return {
    client: { from } as unknown as ReturnType<typeof createAdminClient>,
    from,
    select,
    eq,
  }
}

const originalEnv = process.env.ROTA_MANAGER_EMAIL

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.ROTA_MANAGER_EMAIL
  } else {
    process.env.ROTA_MANAGER_EMAIL = originalEnv
  }
  vi.restoreAllMocks()
})

describe('resolveRotaManagerEmail', () => {
  it('prefers the database setting over the environment variable', async () => {
    process.env.ROTA_MANAGER_EMAIL = 'env@example.com'
    const { client, from, select, eq } = fakeClient({
      data: { value: { value: 'settings@example.com' } },
      error: null,
    })

    await expect(resolveRotaManagerEmail(client)).resolves.toEqual({ email: 'settings@example.com' })
    expect(from).toHaveBeenCalledWith('system_settings')
    expect(select).toHaveBeenCalledWith('value')
    expect(eq).toHaveBeenCalledWith('key', 'rota_manager_email')
  })

  it('accepts a setting stored as a bare string and trims it', async () => {
    const { client } = fakeClient({ data: { value: '  settings@example.com  ' }, error: null })

    await expect(resolveRotaManagerEmail(client)).resolves.toEqual({ email: 'settings@example.com' })
  })

  it('falls back to the environment variable when the setting is absent', async () => {
    process.env.ROTA_MANAGER_EMAIL = 'env@example.com'
    const { client } = fakeClient({ data: null, error: null })

    await expect(resolveRotaManagerEmail(client)).resolves.toEqual({ email: 'env@example.com' })
  })

  it('falls back to the environment variable when the setting is not a valid address', async () => {
    process.env.ROTA_MANAGER_EMAIL = 'env@example.com'
    const { client } = fakeClient({ data: { value: { value: 'not an address' } }, error: null })

    await expect(resolveRotaManagerEmail(client)).resolves.toEqual({ email: 'env@example.com' })
    expect(console.error).toHaveBeenCalled()
  })

  it('returns a configuration error when nothing is configured anywhere', async () => {
    delete process.env.ROTA_MANAGER_EMAIL
    const { client } = fakeClient({ data: null, error: null })

    const result = await resolveRotaManagerEmail(client)

    expect(result).toEqual({
      error: 'No rota manager email is configured. Set one in Settings > Rota, or set ROTA_MANAGER_EMAIL.',
    })
    expect(console.error).toHaveBeenCalled()
  })

  it('returns a configuration error when the environment variable is not a valid address', async () => {
    process.env.ROTA_MANAGER_EMAIL = 'nobody'
    const { client } = fakeClient({ data: null, error: null })

    const result = await resolveRotaManagerEmail(client)

    expect(result).toEqual({ error: 'ROTA_MANAGER_EMAIL is set but is not a valid email address.' })
    expect(console.error).toHaveBeenCalled()
  })

  it('reports a failed read instead of quietly using the environment variable', async () => {
    process.env.ROTA_MANAGER_EMAIL = 'env@example.com'
    const { client } = fakeClient({ data: null, error: { message: 'connection reset' } })

    const result = await resolveRotaManagerEmail(client)

    expect(result).toEqual({ error: 'Could not read the rota_manager_email setting: connection reset' })
    expect(console.error).toHaveBeenCalled()
  })
})
