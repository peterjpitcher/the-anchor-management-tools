// src/lib/checklists/__tests__/scoring.test.ts
import { describe, it, expect } from 'vitest'
import { scoreTimeliness } from '../scoring'
import type { ScoredInstance } from '../types'

const onTime = (): ScoredInstance =>
  ({ completedAt: new Date('2026-07-17T20:00:00Z'), graceUntil: new Date('2026-07-17T21:00:00Z') })
const late = (): ScoredInstance =>
  ({ completedAt: new Date('2026-07-17T22:00:00Z'), graceUntil: new Date('2026-07-17T21:00:00Z') })

describe('scoreTimeliness (spec 7)', () => {
  it('30 on-time -> score 10, green, count 30', () => {
    const r = scoreTimeliness(Array.from({ length: 30 }, onTime))
    expect(r).toEqual({ score: 10, count: 30, band: 'green' })
  })
  it('29 on-time -> suppressed (score null) but count 29', () => {
    const r = scoreTimeliness(Array.from({ length: 29 }, onTime))
    expect(r).toEqual({ score: null, count: 29, band: null })
  })
  it('all late at exactly the boundary counts as on-time (completedAt == graceUntil)', () => {
    const boundary: ScoredInstance =
      { completedAt: new Date('2026-07-17T21:00:00Z'), graceUntil: new Date('2026-07-17T21:00:00Z') }
    const r = scoreTimeliness(Array.from({ length: 30 }, () => boundary))
    expect(r.score).toBe(10)
  })
  it('a mix landing at 7.5 average -> red band', () => {
    // 40 items: 20 on-time (10) + 20 late (5) = avg 7.5
    const items = [...Array.from({ length: 20 }, onTime), ...Array.from({ length: 20 }, late)]
    const r = scoreTimeliness(items)
    expect(r.score).toBe(7.5)
    expect(r.band).toBe('red')
  })
  it('empty -> { score: null, count: 0, band: null }', () => {
    expect(scoreTimeliness([])).toEqual({ score: null, count: 0, band: null })
  })
})
