import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  setActive: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/app/actions/signing', () => ({
  saveSigningTemplate: mocks.save,
  setSigningTemplateActive: mocks.setActive,
}))
vi.mock('@/ds/primitives/Toast', () => ({ toast: mocks.toast }))

import SigningTemplatesManager from '@/app/(authenticated)/settings/signing-templates/SigningTemplatesManager'
import type { SigningTemplateRow } from '@/lib/signing/types'

const BODY = '## What this confirms\nYou have read the policy and you understand what it asks of you at work.'

function template(overrides: Partial<SigningTemplateRow> = {}): SigningTemplateRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'policy_acknowledgement',
    slug: 'policy-phones',
    title: 'Phones at work',
    body: BODY,
    version: 3,
    is_active: false,
    activated_at: null,
    activated_by: null,
    created_at: '2026-10-01T09:00:00.000Z',
    updated_at: '2026-10-10T09:00:00.000Z',
    updated_by: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('switching a template on and off from the settings page', () => {
  it('says which version was on screen when a template is switched on', async () => {
    const shown = template({ version: 3 })
    mocks.setActive.mockResolvedValue({ success: true, data: { ...shown, is_active: true } })
    render(<SigningTemplatesManager initialTemplates={[shown]} loadError={null} />)

    await userEvent.click(screen.getByRole('button', { name: 'Switch On: Phones at work' }))

    await waitFor(() => expect(mocks.setActive).toHaveBeenCalledTimes(1))
    expect(mocks.setActive).toHaveBeenCalledWith({ id: shown.id, active: true, version: 3 })
    expect(await screen.findByRole('button', { name: 'Switch Off: Phones at work' })).toBeInTheDocument()
  })

  it('shows why a switch was refused, and leaves the template showing as off', async () => {
    const shown = template({ version: 3 })
    mocks.setActive.mockResolvedValue({ error: 'This template was changed after you opened it. Reload, read it again, then switch it on.' })
    render(<SigningTemplatesManager initialTemplates={[shown]} loadError={null} />)

    await userEvent.click(screen.getByRole('button', { name: 'Switch On: Phones at work' }))

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith('This template was changed after you opened it. Reload, read it again, then switch it on.')
    )
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Switch On: Phones at work' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Switch Off: Phones at work' })).not.toBeInTheDocument()
  })

  it('says the new version after the wording has been saved on this page', async () => {
    const shown = template({ version: 3 })
    const saved = template({ version: 4, body: `${BODY}\nKeep it in your locker during service.` })
    mocks.save.mockResolvedValue({ success: true, data: saved })
    mocks.setActive.mockResolvedValue({ success: true, data: { ...saved, is_active: true } })
    render(<SigningTemplatesManager initialTemplates={[shown]} loadError={null} />)

    await userEvent.click(screen.getByRole('button', { name: 'Edit Wording: Phones at work' }))
    await userEvent.type(screen.getByLabelText('Title'), '!')
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: 'Switch On: Phones at work' }))

    await waitFor(() => expect(mocks.setActive).toHaveBeenCalledTimes(1))
    expect(mocks.setActive).toHaveBeenCalledWith({ id: shown.id, active: true, version: 4 })
  })

  it('switches a template off, passing the version it is showing', async () => {
    const shown = template({ version: 5, is_active: true })
    mocks.setActive.mockResolvedValue({ success: true, data: { ...shown, is_active: false } })
    render(<SigningTemplatesManager initialTemplates={[shown]} loadError={null} />)

    await userEvent.click(screen.getByRole('button', { name: 'Switch Off: Phones at work' }))

    await waitFor(() => expect(mocks.setActive).toHaveBeenCalledTimes(1))
    expect(mocks.setActive).toHaveBeenCalledWith({ id: shown.id, active: false, version: 5 })
    expect(await screen.findByRole('button', { name: 'Switch On: Phones at work' })).toBeInTheDocument()
  })
})
