import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/app/(authenticated)/settings/api-keys/actions', () => ({
  deleteApiKey: vi.fn(),
  generateApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  updateApiKey: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

import ApiKeysManager from '@/app/(authenticated)/settings/api-keys/ApiKeysManager'
import type { ApiKey } from '@/types/api'

// 23:30 UTC on 1 October 2026 is 00:30 on 2 October in London (BST). The list renders on the
// UTC server first, so a host-zone formatter showed the key as last used on 1 October at 23:30.
const KEY: ApiKey = {
  id: 'key-1',
  key_hash: 'hash',
  name: 'Website',
  description: null,
  permissions: ['read:events'],
  rate_limit: 1000,
  is_active: true,
  last_used_at: '2026-10-01T23:30:00Z',
  expires_at: null,
  created_at: '2026-01-01T09:00:00Z',
  updated_at: '2026-01-01T09:00:00Z',
}

describe('API keys list', () => {
  it('shows when a key was last used on the London clock', () => {
    render(<ApiKeysManager initialKeys={[KEY]} canManage />)

    expect(screen.getAllByText('2 Oct 2026, 00:30').length).toBeGreaterThan(0)
  })
})
