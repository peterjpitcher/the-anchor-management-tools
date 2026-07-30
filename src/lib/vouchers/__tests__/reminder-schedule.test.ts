import { describe, it, expect } from 'vitest'
import { deriveReminderSchedule } from '../reminder-schedule'
import { REMINDER_LEAD_DAYS, REMINDER_MAX_SENDS } from '../constants'
import type { ReminderKind } from '@/types/vouchers'

function derive(overrides: {
  issuedAtLondonDate?: string
  expiryDate: string
  alreadySentKinds?: ReminderKind[]
  todayLondon?: string
}) {
  return deriveReminderSchedule({
    issuedAtLondonDate: overrides.issuedAtLondonDate ?? '2026-07-30',
    expiryDate: overrides.expiryDate,
    alreadySentKinds: overrides.alreadySentKinds ?? [],
    todayLondon: overrides.todayLondon ?? '2026-07-30',
  })
}

describe('deriveReminderSchedule (expiry-relative cadence)', () => {
  it('expiry 30 days out: both pending, at issue plus 23 and issue plus 27 days', () => {
    // Issued 2026-07-30, expiry 2026-08-29. Expiry minus 7 is 2026-08-22
    // (issue + 23) and expiry minus 3 is 2026-08-26 (issue + 27).
    expect(derive({ expiryDate: '2026-08-29' })).toEqual([
      { kind: 'pre_expiry_7', scheduledFor: '2026-08-22', initialStatus: 'pending' },
      { kind: 'pre_expiry_3', scheduledFor: '2026-08-26', initialStatus: 'pending' },
    ])
  })

  it('expiry 5 days out: the 7-day reminder is skipped, the 3-day one is pending', () => {
    expect(derive({ expiryDate: '2026-08-04' })).toEqual([
      { kind: 'pre_expiry_7', scheduledFor: '2026-07-28', initialStatus: 'skipped' },
      { kind: 'pre_expiry_3', scheduledFor: '2026-08-01', initialStatus: 'pending' },
    ])
  })

  it('expiry tomorrow: both skipped, never sent late', () => {
    expect(derive({ expiryDate: '2026-07-31' })).toEqual([
      { kind: 'pre_expiry_7', scheduledFor: '2026-07-24', initialStatus: 'skipped' },
      { kind: 'pre_expiry_3', scheduledFor: '2026-07-28', initialStatus: 'skipped' },
    ])
  })

  it('expiry today: both skipped', () => {
    expect(derive({ expiryDate: '2026-07-30' })).toEqual([
      { kind: 'pre_expiry_7', scheduledFor: '2026-07-23', initialStatus: 'skipped' },
      { kind: 'pre_expiry_3', scheduledFor: '2026-07-27', initialStatus: 'skipped' },
    ])
  })

  it('a target landing exactly on today is pending, not skipped', () => {
    // Expiry 2026-08-06, so expiry minus 7 is today.
    expect(derive({ expiryDate: '2026-08-06' })).toEqual([
      { kind: 'pre_expiry_7', scheduledFor: '2026-07-30', initialStatus: 'pending' },
      { kind: 'pre_expiry_3', scheduledFor: '2026-08-03', initialStatus: 'pending' },
    ])
  })

  it('a kind already sent is not re-emitted', () => {
    expect(derive({ expiryDate: '2026-08-29', alreadySentKinds: ['pre_expiry_7'] })).toEqual([
      { kind: 'pre_expiry_3', scheduledFor: '2026-08-26', initialStatus: 'pending' },
    ])
  })

  it('both kinds already sent: nothing left to schedule', () => {
    expect(
      derive({ expiryDate: '2026-08-29', alreadySentKinds: ['pre_expiry_7', 'pre_expiry_3'] })
    ).toEqual([])
  })

  it('a sent kind is not re-emitted even when its target is still in the future', () => {
    const result = derive({ expiryDate: '2026-08-29', alreadySentKinds: ['pre_expiry_3'] })
    expect(result.map(entry => entry.kind)).not.toContain('pre_expiry_3')
    expect(result).toEqual([
      { kind: 'pre_expiry_7', scheduledFor: '2026-08-22', initialStatus: 'pending' },
    ])
  })

  it('holds London dates across the DST boundary', () => {
    // British Summer Time ends on Sunday 2026-10-25, so both targets sit either
    // side of the clock change. Date arithmetic must not drift them by a day.
    expect(derive({ expiryDate: '2026-10-27', todayLondon: '2026-10-24' })).toEqual([
      { kind: 'pre_expiry_7', scheduledFor: '2026-10-20', initialStatus: 'skipped' },
      { kind: 'pre_expiry_3', scheduledFor: '2026-10-24', initialStatus: 'pending' },
    ])
  })

  it('holds London dates when the whole window sits after the DST boundary', () => {
    expect(derive({ expiryDate: '2026-11-03', todayLondon: '2026-10-24' })).toEqual([
      { kind: 'pre_expiry_7', scheduledFor: '2026-10-27', initialStatus: 'pending' },
      { kind: 'pre_expiry_3', scheduledFor: '2026-10-31', initialStatus: 'pending' },
    ])
  })

  it('crosses a month and a year end without drifting', () => {
    expect(derive({ expiryDate: '2027-01-04', todayLondon: '2026-12-01' })).toEqual([
      { kind: 'pre_expiry_7', scheduledFor: '2026-12-28', initialStatus: 'pending' },
      { kind: 'pre_expiry_3', scheduledFor: '2027-01-01', initialStatus: 'pending' },
    ])
  })

  it('is independent of the issue date', () => {
    const recentlyIssued = derive({ issuedAtLondonDate: '2026-07-29', expiryDate: '2026-08-29' })
    const longIssued = derive({ issuedAtLondonDate: '2026-01-02', expiryDate: '2026-08-29' })
    expect(longIssued).toEqual(recentlyIssued)
  })

  it('returns entries sorted by scheduledFor ascending', () => {
    const dates = derive({ expiryDate: '2026-08-29' }).map(entry => entry.scheduledFor)
    expect(dates).toEqual([...dates].sort())
  })

  it('never exceeds the send cap: sent kinds plus pending entries stay within it', () => {
    const alreadySentKinds: ReminderKind[] = ['pre_expiry_7']
    const pending = derive({ expiryDate: '2026-08-29', alreadySentKinds }).filter(
      entry => entry.initialStatus === 'pending'
    )
    expect(alreadySentKinds.length + pending.length).toBeLessThanOrEqual(REMINDER_MAX_SENDS)
    expect(REMINDER_LEAD_DAYS).toEqual([7, 3])
  })
})
