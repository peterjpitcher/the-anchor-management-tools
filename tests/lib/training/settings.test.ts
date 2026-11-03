import { describe, expect, it, vi } from 'vitest'
import { createFakeDb } from '../../helpers/fakeSupabaseDb'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import {
  TRAINING_AUTO_ASSIGN_SETTING_KEY,
  TRAINING_EMAILS_SETTING_KEY,
  getTrainingAutoAssignEnabled,
  getTrainingEmailsEnabled,
  isTrainingEmailsValueOn,
  readTrainingAutoAssignSetting,
  readTrainingEmailsSetting,
  setTrainingAutoAssignEnabled,
  setTrainingEmailsEnabled,
} from '@/lib/training/settings'

/**
 * The `training_emails_enabled` and `training_auto_assign_enabled` switches: each off unless its
 * stored value is the boolean true, and each read and written on its own row.
 */

type Client = Parameters<typeof readTrainingEmailsSetting>[0]

describe('isTrainingEmailsValueOn', () => {
  it('only the boolean true counts as on', () => {
    expect(isTrainingEmailsValueOn(true)).toBe(true)
    expect(isTrainingEmailsValueOn({ value: true })).toBe(true)
    for (const value of [false, { value: false }, 'true', 1, null, undefined, {}, [true], { value: 'true' }]) {
      expect(isTrainingEmailsValueOn(value)).toBe(false)
    }
  })
})

describe('readTrainingEmailsSetting', () => {
  it('is off when there is no row', async () => {
    const db = createFakeDb({ system_settings: [] })
    expect(await readTrainingEmailsSetting(db.client as unknown as Client)).toEqual({ readable: true, enabled: false, updatedAt: null })
    expect(await getTrainingEmailsEnabled(db.client as unknown as Client)).toBe(false)
  })

  it('is on when the row says true', async () => {
    const db = createFakeDb({
      system_settings: [{ id: 's1', key: TRAINING_EMAILS_SETTING_KEY, value: { value: true }, updated_at: '2026-11-02T09:00:00.000Z' }],
    })
    expect(await readTrainingEmailsSetting(db.client as unknown as Client)).toEqual({
      readable: true,
      enabled: true,
      updatedAt: '2026-11-02T09:00:00.000Z',
    })
  })

  it('says unreadable, and off, when the read fails', async () => {
    const db = createFakeDb({ system_settings: [] })
    db.failNext({ table: 'system_settings', operation: 'select', message: 'connection refused' })
    const setting = await readTrainingEmailsSetting(db.client as unknown as Client)
    expect(setting).toEqual({ readable: false, enabled: false, error: 'connection refused' })
  })
})

describe('setTrainingEmailsEnabled', () => {
  it('writes the row and reads back the same value', async () => {
    const db = createFakeDb({ system_settings: [] })
    await setTrainingEmailsEnabled(true, db.client as unknown as Client)
    expect(db.rows('system_settings')).toEqual([
      expect.objectContaining({ key: TRAINING_EMAILS_SETTING_KEY, value: { value: true } }),
    ])
    expect(await getTrainingEmailsEnabled(db.client as unknown as Client)).toBe(true)

    await setTrainingEmailsEnabled(false, db.client as unknown as Client)
    expect(db.rows('system_settings')).toHaveLength(1)
    expect(await getTrainingEmailsEnabled(db.client as unknown as Client)).toBe(false)
  })

  it('throws when the write is refused, so the switch never claims it moved', async () => {
    const db = createFakeDb({ system_settings: [] })
    db.failNext({ table: 'system_settings', operation: 'insert', message: 'permission denied' })
    await expect(setTrainingEmailsEnabled(true, db.client as unknown as Client)).rejects.toThrow('permission denied')
  })

  it('refuses anything that is not true or false', async () => {
    const db = createFakeDb({ system_settings: [] })
    await expect(setTrainingEmailsEnabled('yes' as unknown as boolean, db.client as unknown as Client)).rejects.toThrow()
    expect(db.rows('system_settings')).toHaveLength(0)
  })
})

describe('the automatic assignment switch', () => {
  it('is off when there is no row, even when the emails switch is on', async () => {
    const db = createFakeDb({
      system_settings: [{ id: 's1', key: TRAINING_EMAILS_SETTING_KEY, value: { value: true }, updated_at: '2026-11-02T09:00:00.000Z' }],
    })
    expect(TRAINING_AUTO_ASSIGN_SETTING_KEY).toBe('training_auto_assign_enabled')
    expect(await readTrainingAutoAssignSetting(db.client as unknown as Client)).toEqual({ readable: true, enabled: false, updatedAt: null })
    expect(await getTrainingAutoAssignEnabled(db.client as unknown as Client)).toBe(false)
  })

  it('only the boolean true turns it on', async () => {
    for (const [value, on] of [[{ value: true }, true], [true, true], [{ value: 'true' }, false], [{ value: 1 }, false], [{ value: false }, false]] as const) {
      const db = createFakeDb({
        system_settings: [{ id: 's1', key: TRAINING_AUTO_ASSIGN_SETTING_KEY, value, updated_at: '2026-11-03T09:00:00.000Z' }],
      })
      expect(await getTrainingAutoAssignEnabled(db.client as unknown as Client)).toBe(on)
    }
  })

  it('says unreadable, and off, when the read fails', async () => {
    const db = createFakeDb({ system_settings: [] })
    db.failNext({ table: 'system_settings', operation: 'select', message: 'connection refused' })
    expect(await readTrainingAutoAssignSetting(db.client as unknown as Client)).toEqual({ readable: false, enabled: false, error: 'connection refused' })
  })

  it('writes its own row, leaving the emails switch alone', async () => {
    const db = createFakeDb({
      system_settings: [{ id: 's1', key: TRAINING_EMAILS_SETTING_KEY, value: { value: true }, updated_at: '2026-11-02T09:00:00.000Z' }],
    })
    await setTrainingAutoAssignEnabled(true, db.client as unknown as Client)
    expect(db.rows('system_settings')).toEqual([
      expect.objectContaining({ key: TRAINING_EMAILS_SETTING_KEY, value: { value: true } }),
      expect.objectContaining({ key: TRAINING_AUTO_ASSIGN_SETTING_KEY, value: { value: true } }),
    ])
    expect(await getTrainingAutoAssignEnabled(db.client as unknown as Client)).toBe(true)
    await setTrainingAutoAssignEnabled(false, db.client as unknown as Client)
    expect(await getTrainingAutoAssignEnabled(db.client as unknown as Client)).toBe(false)
    expect(await getTrainingEmailsEnabled(db.client as unknown as Client)).toBe(true)
  })

  it('throws when the write is refused, and refuses anything that is not true or false', async () => {
    const db = createFakeDb({ system_settings: [] })
    db.failNext({ table: 'system_settings', operation: 'insert', message: 'permission denied' })
    await expect(setTrainingAutoAssignEnabled(true, db.client as unknown as Client)).rejects.toThrow('permission denied')
    await expect(setTrainingAutoAssignEnabled('yes' as unknown as boolean, db.client as unknown as Client)).rejects.toThrow()
    expect(db.rows('system_settings')).toHaveLength(0)
  })
})
