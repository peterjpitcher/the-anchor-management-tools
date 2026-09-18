import { afterEach, describe, expect, it, vi } from 'vitest'

// env.ts validates once, when it is first imported, so each case sets the variables it needs
// and then loads a fresh copy.
async function loadEnv(): Promise<typeof import('@/lib/env')> {
  vi.resetModules()
  return import('@/lib/env')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('getAppUrl', () => {
  it('returns the live value unchanged, so production links stay the same', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://management.orangejelly.co.uk')

    const { getAppUrl } = await loadEnv()

    expect(getAppUrl()).toBe('https://management.orangejelly.co.uk')
  })

  it('drops trailing slashes so callers can append a path', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://management.example.test//')

    const { getAppUrl } = await loadEnv()

    expect(getAppUrl()).toBe('https://management.example.test')
    expect(`${getAppUrl()}/g/token/manage-booking`).toBe(
      'https://management.example.test/g/token/manage-booking'
    )
  })

  it('refuses to load when the variable is missing, rather than falling back to localhost', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined)

    await expect(loadEnv()).rejects.toThrow('NEXT_PUBLIC_APP_URL: Required')
  })

  it('refuses a value that is not an absolute URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'management.orangejelly.co.uk')

    await expect(loadEnv()).rejects.toThrow('NEXT_PUBLIC_APP_URL must be a valid URL')
  })
})

describe('Twilio status callback', () => {
  it('uses the app URL when no webhook override is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://management.orangejelly.co.uk')
    vi.stubEnv('WEBHOOK_BASE_URL', undefined)
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined)

    const { TWILIO_STATUS_CALLBACK } = await loadEnv()

    expect(TWILIO_STATUS_CALLBACK).toBe('https://management.orangejelly.co.uk/api/webhooks/twilio')
  })
})
