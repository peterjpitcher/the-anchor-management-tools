import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import CustomerLabelsClient from '@/app/(authenticated)/settings/customer-labels/CustomerLabelsClient'
import ApiKeysManager from '@/app/(authenticated)/settings/api-keys/ApiKeysManager'
import ImportMessagesClient from '@/app/(authenticated)/settings/import-messages/ImportMessagesClient'
import type { CustomerLabel } from '@/app/actions/customer-labels'
import type { ApiKey } from '@/types/api'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/settings',
}))

vi.mock('@/ds/primitives/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

vi.mock('@/app/actions/customer-labels', () => ({
  getCustomerLabels: vi.fn(),
  createCustomerLabel: vi.fn(),
  updateCustomerLabel: vi.fn(),
  deleteCustomerLabel: vi.fn(),
  applyLabelsRetroactively: vi.fn(),
}))

vi.mock('@/app/(authenticated)/settings/api-keys/actions', () => ({
  deleteApiKey: vi.fn(),
  generateApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  updateApiKey: vi.fn(),
}))

const importMissedMessages = vi.fn()
vi.mock('@/app/actions/import-messages', () => ({
  importMissedMessages: (...args: unknown[]) => importMissedMessages(...args),
}))

const label: CustomerLabel = {
  id: 'label-1',
  name: 'VIP',
  description: 'High value customers',
  color: '#10B981',
  icon: 'star',
  auto_apply_rules: {},
  created_at: '',
  updated_at: '',
}

const apiKey: ApiKey = {
  id: 'key-1',
  name: 'Website',
  description: null,
  key_hash: 'hash',
  permissions: ['read:events'],
  rate_limit: 1000,
  is_active: true,
  last_used_at: null,
  expires_at: null,
  created_at: '2026-09-01T10:00:00.000Z',
  updated_at: '2026-09-01T10:00:00.000Z',
}

describe('settings confirm dialogs use the right colour', () => {
  it('draws Apply Retroactively in primary: it changes labels but deletes nothing', () => {
    render(<CustomerLabelsClient initialLabels={[label]} canManage />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Apply Retroactively' })[0])

    const confirm = screen.getByRole('button', { name: 'Apply and Tidy Labels' })
    expect(confirm).toHaveClass('bg-primary')
    expect(confirm).not.toHaveClass('bg-danger')
  })

  it('draws deleting a label in red', () => {
    render(<CustomerLabelsClient initialLabels={[label]} canManage />)

    fireEvent.click(screen.getByLabelText('Delete label'))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toHaveClass('bg-danger')
  })

  it('draws revoking an API key in red', () => {
    render(<ApiKeysManager initialKeys={[apiKey]} canManage />)

    fireEvent.click(screen.getByRole('button', { name: 'Revoke API key' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Revoke' })).toHaveClass('bg-danger')
  })
})

describe('settings groups of controls are named by a visible legend', () => {
  it('puts the API key permissions in a fieldset named Permissions', () => {
    render(<ApiKeysManager initialKeys={[apiKey]} canManage />)

    fireEvent.click(screen.getAllByRole('button', { name: 'New API Key' })[0])

    const permissions = screen.getByRole('group', { name: 'Permissions' })
    expect(permissions.tagName).toBe('FIELDSET')
    expect(within(permissions).getByRole('checkbox', { name: 'Read Events' })).toBeChecked()
  })

  it('puts the label colours and icons in fieldsets', () => {
    render(<CustomerLabelsClient initialLabels={[label]} canManage />)

    fireEvent.click(screen.getAllByRole('button', { name: 'New Label' })[0])

    // Named like every other create dialog in Settings ("New Template", "New Period").
    expect(screen.getByRole('dialog', { name: 'New Customer Label' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Colour' }).tagName).toBe('FIELDSET')
    expect(screen.getByRole('group', { name: 'Icon' }).tagName).toBe('FIELDSET')
  })
})

describe('Import Messages', () => {
  it('is titled with its Settings tile label', () => {
    render(<ImportMessagesClient canManage defaultStartDate="2026-09-19" defaultEndDate="2026-09-26" />)

    // PageLayout renders its header twice (desktop and phone).
    expect(screen.getAllByRole('heading', { level: 1, name: 'Import Messages' })[0]).toBeInTheDocument()
  })

  it('colours the imported count green and the failed count red', async () => {
    importMissedMessages.mockResolvedValueOnce({
      success: true,
      summary: {
        totalFound: 12,
        inboundMessages: 7,
        outboundMessages: 5,
        alreadyInDatabase: 4,
        imported: 6,
        failed: 2,
      },
    })
    render(<ImportMessagesClient canManage defaultStartDate="2026-09-19" defaultEndDate="2026-09-26" />)

    fireEvent.click(screen.getByRole('button', { name: 'Import Messages' }))

    expect(await screen.findByText('6')).toHaveClass('text-success-fg')
    expect(screen.getByText('2')).toHaveClass('text-danger-fg')
  })
})
