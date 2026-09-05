import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { db, query, load } = vi.hoisted(() => {
  const query = vi.fn()
  return { query, db: { from: vi.fn(() => ({ select: vi.fn(() => ({ in: query })) })) }, load: vi.fn() }
})
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }))
vi.mock('@/lib/business-hours/effective', () => ({ loadPublishedVersions: load }))
import { getScreeningHours, projectScreeningDay, validateScreeningDates } from '@/lib/business-hours/screening-hours'

const day = { day_of_week: 6, opens: '12:00', closes: '23:00', kitchen_opens: '12:00', kitchen_closes: '21:00', is_closed: false, is_kitchen_closed: false, schedule_config: null }
const sitting = (starts_at: string, ends_at: string) => ({ name: 'service', starts_at, ends_at, capacity: 10, booking_type: 'regular' })
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-05T08:00:00Z'))
  load.mockResolvedValue([{ effectiveFrom: '2026-01-01', rows: [day] }])
  query.mockReset().mockResolvedValue({ data: [], error: null })
})

afterEach(() => vi.useRealTimers())

describe('strict screening hours', () => {
  it('does not invent regular opening when exceptions cannot be read', async () => {
    query.mockRejectedValue(new Error('database unavailable'))
    await expect(getScreeningHours(['2026-11-07'])).rejects.toThrow()
  })
  it.each([{ data: null, error: null }, { data: [], error: { message: 'failed' } }])('rejects missing or failed exception reads', async result => {
    query.mockResolvedValue(result)
    await expect(getScreeningHours(['2026-11-07'])).rejects.toThrow()
  })
  it('uses complete existing special overrides without inheriting kitchen', async () => {
    query.mockResolvedValue({ data: [{ ...day, date: '2026-11-07', opens: '15:00', kitchen_opens: null, kitchen_closes: null }], error: null })
    const result = await getScreeningHours(['2026-11-07', '2026-11-07'])
    expect(result.days).toHaveLength(1)
    expect(result.days[0]).toMatchObject({ regularOpensAt: '2026-11-07T12:00:00.000Z', bar: { startAt: '2026-11-07T15:00:00.000Z' }, kitchen: [], kitchenState: 'known', hasSpecialHours: true })
    expect(load).toHaveBeenCalledWith(db)
    expect(query).toHaveBeenCalledWith('date', ['2026-11-07'])
  })
  it('honours future published versions and rejects absent weekdays', async () => {
    load.mockResolvedValue([{ effectiveFrom: '2026-01-01', rows: [day] }, { effectiveFrom: '2026-11-01', rows: [{ ...day, opens: '14:00' }] }])
    expect((await getScreeningHours(['2026-11-07'])).days[0].bar?.startAt).toBe('2026-11-07T14:00:00.000Z')
    await expect(getScreeningHours(['2026-11-08'])).rejects.toThrow('missing')
  })
  it('preserves split kitchen gaps and empty sittings fallback', () => {
    expect(projectScreeningDay('2026-11-07', { ...day, schedule_config: [sitting('12:00', '15:00'), sitting('16:00', '22:00')] }).kitchen).toEqual([
      { startAt: '2026-11-07T12:00:00.000Z', endAt: '2026-11-07T15:00:00.000Z' },
      { startAt: '2026-11-07T16:00:00.000Z', endAt: '2026-11-07T21:00:00.000Z' },
    ])
    expect(projectScreeningDay('2026-11-07', { ...day, schedule_config: [] }).kitchen).toHaveLength(1)
  })
  it('distinguishes closed pub, closed kitchen and unknown kitchen', () => {
    expect(projectScreeningDay('2026-11-07', { ...day, is_closed: true })).toMatchObject({ state: 'closed', bar: null, kitchen: [] })
    expect(projectScreeningDay('2026-11-07', { ...day, is_kitchen_closed: true })).toMatchObject({ state: 'open', kitchen: [], kitchenState: 'known' })
    expect(projectScreeningDay('2026-11-07', { ...day, kitchen_closes: 'broken' })).toMatchObject({ state: 'open', kitchen: [], kitchenState: 'unknown' })
    expect(() => projectScreeningDay('2026-11-07', { ...day, opens: null })).toThrow()
  })
  it('handles BST and overnight DST changes independently of host zone', () => {
    expect(projectScreeningDay('2026-07-04', day).bar?.startAt).toBe('2026-07-04T11:00:00.000Z')
    expect(projectScreeningDay('2026-10-24', { ...day, closes: '02:00' }).bar).toEqual({ startAt: '2026-10-24T11:00:00.000Z', endAt: '2026-10-25T02:00:00.000Z' })
    expect(projectScreeningDay('2026-11-07', { ...day, opens: '20:00', closes: '02:00', kitchen_opens: '20:00', kitchen_closes: '01:00' }).kitchen[0].endAt).toBe('2026-11-08T01:00:00.000Z')
  })
  it('fingerprints operational facts, not retrieval time', () => {
    const first = projectScreeningDay('2026-11-07', day)
    vi.setSystemTime(new Date('2026-09-06T08:00:00Z'))
    expect(projectScreeningDay('2026-11-07', day).fingerprint).toBe(first.fingerprint)
    expect(projectScreeningDay('2026-11-07', { ...day, closes: '22:00' }).fingerprint).not.toBe(first.fingerprint)
  })
  it('runs in the requested host timezone', () => {
    expect(process.env.TZ).toBe(process.env.SCREENING_TEST_TZ ?? 'Europe/London')
  })
  it('clamps leap days at the twelve-month horizon', () => {
    expect(validateScreeningDates(['2025-02-28'], '2024-02-29')).toEqual(['2025-02-28'])
    expect(() => validateScreeningDates(['2025-03-01'], '2024-02-29')).toThrow()
    expect(validateScreeningDates(['2024-03-01'], '2023-03-01')).toEqual(['2024-03-01'])
  })
  it('validates real dates and bounded planning horizon', () => {
    for (const dates of [[], ['2026-02-30'], ['2026-09-04'], ['2028-01-01']]) expect(() => validateScreeningDates(dates)).toThrow()
    expect(() => validateScreeningDates(Array.from({ length: 32 }, (_, i) => i < 30 ? `2026-11-${String(i + 1).padStart(2, '0')}` : `2026-12-0${i - 29}`))).toThrow()
    expect(validateScreeningDates(['2027-09-05'])).toEqual(['2027-09-05'])
  })
})
