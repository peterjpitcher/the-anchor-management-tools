import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Training page switches for training emails and automatic assignment: reading needs
 * training:view, changing needs training:publish, and every change (or failed change) is audited.
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  checkUserPermission: vi.fn(),
  readTrainingEmailsSetting: vi.fn(),
  setTrainingEmailsEnabled: vi.fn(),
  readTrainingAutoAssignSetting: vi.fn(),
  setTrainingAutoAssignEnabled: vi.fn(),
  logAuditEvent: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: mocks.checkUserPermission }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.logAuditEvent }))
vi.mock('@/lib/training/settings', () => ({
  readTrainingEmailsSetting: mocks.readTrainingEmailsSetting,
  setTrainingEmailsEnabled: mocks.setTrainingEmailsEnabled,
  readTrainingAutoAssignSetting: mocks.readTrainingAutoAssignSetting,
  setTrainingAutoAssignEnabled: mocks.setTrainingAutoAssignEnabled,
}))

import {
  getTrainingAutoAssignSwitch,
  getTrainingEmailsSwitch,
  setTrainingAutoAssignSwitch,
  setTrainingEmailsSwitch,
} from '@/app/actions/training-settings'

function permissions(granted: Array<'view' | 'publish'>): void {
  mocks.checkUserPermission.mockImplementation(async (module: string, action: string) =>
    module === 'training' && (granted as string[]).includes(action))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'manager@example.com' } } })
  mocks.readTrainingEmailsSetting.mockResolvedValue({ readable: true, enabled: false, updatedAt: null })
  mocks.setTrainingEmailsEnabled.mockResolvedValue({ enabled: true, updatedAt: '2026-11-02T09:00:00.000Z' })
  mocks.readTrainingAutoAssignSetting.mockResolvedValue({ readable: true, enabled: false, updatedAt: null })
  mocks.setTrainingAutoAssignEnabled.mockResolvedValue({ enabled: true, updatedAt: '2026-11-03T09:00:00.000Z' })
})

describe('getTrainingEmailsSwitch', () => {
  it('throws without a session', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })
    await expect(getTrainingEmailsSwitch()).rejects.toThrow('Unauthorized')
  })

  it('throws without training:view', async () => {
    permissions([])
    await expect(getTrainingEmailsSwitch()).rejects.toThrow('Insufficient permissions')
  })

  it('shows the switch, and whether this user may change it', async () => {
    permissions(['view'])
    expect(await getTrainingEmailsSwitch()).toEqual({ success: true, data: { enabled: false, updatedAt: null, canChange: false } })
    permissions(['view', 'publish'])
    expect((await getTrainingEmailsSwitch()).data?.canChange).toBe(true)
  })

  it('says so when the setting cannot be read, rather than showing it off', async () => {
    permissions(['view'])
    mocks.readTrainingEmailsSetting.mockResolvedValue({ readable: false, enabled: false, error: 'timeout' })
    expect(await getTrainingEmailsSwitch()).toEqual({ error: expect.stringContaining('could not be read') })
  })
})

describe('setTrainingEmailsSwitch', () => {
  it('throws without training:publish and writes nothing', async () => {
    permissions(['view'])
    await expect(setTrainingEmailsSwitch({ enabled: true })).rejects.toThrow('Insufficient permissions')
    expect(mocks.setTrainingEmailsEnabled).not.toHaveBeenCalled()
  })

  it('refuses anything but true or false', async () => {
    permissions(['view', 'publish'])
    expect(await setTrainingEmailsSwitch({ enabled: 'yes' as unknown as boolean })).toEqual({ error: 'Choose on or off.' })
    expect(mocks.setTrainingEmailsEnabled).not.toHaveBeenCalled()
  })

  it('switches on, audits the change and refreshes the page', async () => {
    permissions(['view', 'publish'])
    expect(await setTrainingEmailsSwitch({ enabled: true })).toEqual({ success: true, data: { enabled: true } })
    expect(mocks.setTrainingEmailsEnabled).toHaveBeenCalledWith(true)
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      resource_type: 'training_settings',
      resource_id: 'training_emails_enabled',
      operation_status: 'success',
      old_values: { enabled: false },
      new_values: { enabled: true },
    }))
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/employees/training')
  })

  it('reports a failed save and audits the failure', async () => {
    permissions(['view', 'publish'])
    mocks.setTrainingEmailsEnabled.mockRejectedValue(new Error('permission denied'))
    expect(await setTrainingEmailsSwitch({ enabled: true })).toEqual({ error: 'The setting could not be saved. Please try again.' })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ operation_status: 'failure' }))
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})

describe('the automatic assignment switch', () => {
  it('needs a session and training:view to read', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })
    await expect(getTrainingAutoAssignSwitch()).rejects.toThrow('Unauthorized')
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'manager@example.com' } } })
    permissions([])
    await expect(getTrainingAutoAssignSwitch()).rejects.toThrow('Insufficient permissions')
  })

  it('shows its own setting, not the emails one, and whether this user may change it', async () => {
    mocks.readTrainingEmailsSetting.mockResolvedValue({ readable: true, enabled: true, updatedAt: null })
    permissions(['view'])
    expect(await getTrainingAutoAssignSwitch()).toEqual({ success: true, data: { enabled: false, updatedAt: null, canChange: false } })
    permissions(['view', 'publish'])
    expect((await getTrainingAutoAssignSwitch()).data?.canChange).toBe(true)
  })

  it('says so when it cannot be read', async () => {
    permissions(['view'])
    mocks.readTrainingAutoAssignSetting.mockResolvedValue({ readable: false, enabled: false, error: 'timeout' })
    expect(await getTrainingAutoAssignSwitch()).toEqual({ error: expect.stringContaining('automatic assignment setting could not be read') })
  })

  it('cannot be changed without training:publish', async () => {
    permissions(['view'])
    await expect(setTrainingAutoAssignSwitch({ enabled: true })).rejects.toThrow('Insufficient permissions')
    expect(mocks.setTrainingAutoAssignEnabled).not.toHaveBeenCalled()
  })

  it('switches on, audited under its own key, and leaves the emails switch alone', async () => {
    permissions(['view', 'publish'])
    expect(await setTrainingAutoAssignSwitch({ enabled: true })).toEqual({ success: true, data: { enabled: true } })
    expect(mocks.setTrainingAutoAssignEnabled).toHaveBeenCalledWith(true)
    expect(mocks.setTrainingEmailsEnabled).not.toHaveBeenCalled()
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      resource_type: 'training_settings',
      resource_id: 'training_auto_assign_enabled',
      operation_status: 'success',
      old_values: { enabled: false },
      new_values: { enabled: true },
    }))
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/employees/training')
  })

  it('reports a failed save and audits the failure', async () => {
    permissions(['view', 'publish'])
    mocks.setTrainingAutoAssignEnabled.mockRejectedValue(new Error('permission denied'))
    expect(await setTrainingAutoAssignSwitch({ enabled: false })).toEqual({ error: 'The setting could not be saved. Please try again.' })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      resource_id: 'training_auto_assign_enabled',
      operation_status: 'failure',
    }))
  })
})
