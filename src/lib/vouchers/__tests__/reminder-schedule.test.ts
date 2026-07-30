import { describe, it, expect } from 'vitest'
import { deriveReminderSchedule } from '../reminder-schedule'
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

describe('deriveReminderSchedule (spec 5.2)', () => {
  it('normal long expiry (120 days): day30 and pre_expiry pending, day90 dropped by the cap', () => {
    expect(derive({ expiryDate: '2026-11-27' })).toEqual([
      { kind: 'day30', scheduledFor: '2026-08-29', initialStatus: 'pending' },
      { kind: 'pre_expiry', scheduledFor: '2026-11-13', initialStatus: 'pending' },
    ])
  })

  it('expiry 40 days out: day30 plus pre_expiry at expiry minus 14, no day90', () => {
    expect(derive({ expiryDate: '2026-09-08' })).toEqual([
      { kind: 'pre_expiry', scheduledFor: '2026-08-25', initialStatus: 'pending' },
      { kind: 'day30', scheduledFor: '2026-08-29', initialStatus: 'pending' },
    ])
  })

  it('expiry 10 days out: pre_expiry only, recorded as skipped because expiry minus 14 is before issue', () => {
    expect(derive({ expiryDate: '2026-08-09' })).toEqual([
      { kind: 'pre_expiry', scheduledFor: '2026-07-26', initialStatus: 'skipped' },
    ])
  })

  it('expiry 20 days out: pre_expiry at day 6, day30 dropped by the expiry rule', () => {
    expect(derive({ expiryDate: '2026-08-19' })).toEqual([
      { kind: 'pre_expiry', scheduledFor: '2026-08-05', initialStatus: 'pending' },
    ])
  })

  it('expiry exactly on day30: day30 dropped, pre_expiry pending', () => {
    expect(derive({ expiryDate: '2026-08-29' })).toEqual([
      { kind: 'pre_expiry', scheduledFor: '2026-08-15', initialStatus: 'pending' },
    ])
  })

  it('late assignment: a day30 already in the past is skipped, never sent late', () => {
    const result = derive({
      issuedAtLondonDate: '2026-06-20',
      expiryDate: '2026-10-18',
      todayLondon: '2026-07-30',
    })
    expect(result).toEqual([
      { kind: 'day30', scheduledFor: '2026-07-20', initialStatus: 'skipped' },
      { kind: 'day90', scheduledFor: '2026-09-18', initialStatus: 'pending' },
      { kind: 'pre_expiry', scheduledFor: '2026-10-04', initialStatus: 'pending' },
    ])
  })

  it('a milestone scheduled today is still pending, not skipped', () => {
    expect(
      derive({
        issuedAtLondonDate: '2026-06-30',
        expiryDate: '2026-10-28',
        todayLondon: '2026-07-30',
      })
    ).toEqual([
      { kind: 'day30', scheduledFor: '2026-07-30', initialStatus: 'pending' },
      { kind: 'pre_expiry', scheduledFor: '2026-10-14', initialStatus: 'pending' },
    ])
  })

  it('cap: one already-sent kind leaves budget for one reminder, kept as pre_expiry over day90', () => {
    expect(
      derive({
        issuedAtLondonDate: '2026-06-20',
        expiryDate: '2026-10-18',
        todayLondon: '2026-07-30',
        alreadySentKinds: ['day30'],
      })
    ).toEqual([{ kind: 'pre_expiry', scheduledFor: '2026-10-04', initialStatus: 'pending' }])
  })

  it('cap: two already-sent kinds leave no budget at all', () => {
    expect(
      derive({
        issuedAtLondonDate: '2026-06-20',
        expiryDate: '2026-10-18',
        todayLondon: '2026-07-30',
        alreadySentKinds: ['day30', 'day90'],
      })
    ).toEqual([])
  })

  it('already-sent kinds are never re-emitted even when still in range', () => {
    const result = derive({ expiryDate: '2026-11-27', alreadySentKinds: ['day30'] })
    expect(result.map(entry => entry.kind)).not.toContain('day30')
    expect(result).toEqual([
      { kind: 'pre_expiry', scheduledFor: '2026-11-13', initialStatus: 'pending' },
    ])
  })

  it('pre_expiry is suppressed when day90 lands within the 7 days before it', () => {
    // Expiry 105 days out: day90 2026-10-28, pre_expiry would be 2026-10-29
    expect(derive({ expiryDate: '2026-11-12' })).toEqual([
      { kind: 'day30', scheduledFor: '2026-08-29', initialStatus: 'pending' },
      { kind: 'day90', scheduledFor: '2026-10-28', initialStatus: 'pending' },
    ])
  })

  it('pre_expiry is suppressed when day90 lands exactly on it', () => {
    // Expiry 104 days out: day90 and expiry minus 14 are both 2026-10-28
    expect(derive({ expiryDate: '2026-11-11' })).toEqual([
      { kind: 'day30', scheduledFor: '2026-08-29', initialStatus: 'pending' },
      { kind: 'day90', scheduledFor: '2026-10-28', initialStatus: 'pending' },
    ])
  })

  it('a milestone falling after pre_expiry does not suppress it; the cap drops day90 first', () => {
    // Expiry 100 days out: pre_expiry 2026-10-24 comes before day90 2026-10-28,
    // so both survive suppression and the 2-send cap drops day90 (day90 first,
    // then day30; pre_expiry is kept preferentially)
    expect(derive({ expiryDate: '2026-11-07' })).toEqual([
      { kind: 'day30', scheduledFor: '2026-08-29', initialStatus: 'pending' },
      { kind: 'pre_expiry', scheduledFor: '2026-10-24', initialStatus: 'pending' },
    ])
  })

  it('returns entries sorted by scheduledFor ascending', () => {
    const result = derive({
      issuedAtLondonDate: '2026-06-20',
      expiryDate: '2026-10-18',
      todayLondon: '2026-07-30',
    })
    const dates = result.map(entry => entry.scheduledFor)
    expect(dates).toEqual([...dates].sort())
  })

  it('skipped entries never consume the send budget', () => {
    // day30 skipped (past), day90 and pre_expiry still both pending within cap
    const result = derive({
      issuedAtLondonDate: '2026-06-20',
      expiryDate: '2026-10-18',
      todayLondon: '2026-07-30',
    })
    const pendingCount = result.filter(entry => entry.initialStatus === 'pending').length
    expect(pendingCount).toBe(2)
  })
})
