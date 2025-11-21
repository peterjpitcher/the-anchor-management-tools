import '@testing-library/jest-dom'
import { vi } from 'vitest'
import { mockTwilioClient } from './tests/mocks/twilio'
import { mockGraphClient } from './tests/mocks/microsoft-graph'

// Mock Supabase environment variables
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role-key'

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
