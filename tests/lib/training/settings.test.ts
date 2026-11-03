import { describe, expect, it, vi } from 'vitest'
import { createFakeDb } from '../../helpers/fakeSupabaseDb'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import {
  TRAINING_EMAILS_SETTING_KEY,
  getTrainingEmailsEnabled,
  isTrainingEmailsValueOn,
  readTrainingEmailsSetting,
  setTrainingEmailsEnabled,
} from '@/lib/training/settings'

/** The `training_emails_enabled` switch: off unless the stored value is the boolean true. */

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
