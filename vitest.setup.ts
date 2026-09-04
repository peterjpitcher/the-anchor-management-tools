import '@testing-library/jest-dom'
import { vi } from 'vitest'
import { mockTwilioClient } from './tests/mocks/twilio'
import { mockGraphClient } from './tests/mocks/microsoft-graph'

vi.mock('server-only', () => ({}))

// Mock required environment variables
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role-key'
process.env.CRON_SECRET = 'dummy-cron-secret'
process.env.NEXT_PUBLIC_APP_URL = 'https://example.com'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}))

// Global Mock for Twilio
vi.mock('twilio', () => ({
  default: () => mockTwilioClient,
}))

// Global Mock for Microsoft Graph
vi.mock('@microsoft/microsoft-graph-client', () => ({
  Client: {
    initWithMiddleware: () => mockGraphClient
  }
}))

// Mock Azure Identity (used by Graph)
vi.mock('@azure/identity', () => ({
  ClientSecretCredential: vi.fn().mockImplementation(() => ({
    getToken: vi.fn().mockResolvedValue({ token: 'MOCK_TOKEN' })
  }))
}))

// Global Mock for next/font/google.
// next/font is a build-time transform with no loader under Vitest, so any test that
// renders a component importing the guest font module (anything pulling in GuestShell,
// including the @/components/features/guest barrel) would fail without this.
vi.mock('next/font/google', () => {
  const font = (): { variable: string; className: string } => ({
    variable: 'mock-font-variable',
    className: 'mock-font',
  })
  return {
    DM_Serif_Display: font,
    Outfit: font,
    Clicker_Script: font,
    Inter: font,
    JetBrains_Mono: font,
  }
})

// jsdom has no ResizeObserver, and Headless UI's Menu constructs one as soon as
// a dropdown opens. Without this, opening any DS Dropdown in a test throws an
// unhandled ReferenceError that can fail unrelated assertions in the same file.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}
