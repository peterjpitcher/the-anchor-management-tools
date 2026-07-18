// src/lib/checklists/__tests__/mismatch.test.ts
import { describe, it, expect } from 'vitest'
import { detectMismatches } from '../mismatch'

const D = (iso: string) => new Date(iso)
const base = {
  opensAt: D('2026-05-25T11:00:00Z'),   // 12:00 BST
  closesAt: D('2026-05-25T21:00:00Z'),  // 22:00 BST
  earliestStartAt: D('2026-05-25T11:00:00Z'),
  latestEndAt: D('2026-05-25T21:00:00Z'),
  earlyThresholdMinutes: 90,
  thresholdMinutes: 30,
}

describe('detectMismatches (spec 8)', () => {
  it('normal day (start = open, end = close) -> empty', () => {
    expect(detectMismatches(base)).toEqual([])
  })
  it('nobody rostered until 16:00 vs a 12:00 open -> no_cover_at_open', () => {
    const r = detectMismatches({ ...base, earliestStartAt: D('2026-05-25T15:00:00Z') }) // 16:00 BST
    expect(r.map(m => m.kind)).toContain('no_cover_at_open')
  })
  it('a cleaning shift exactly 90 min before open does NOT trigger rota_before_open (strict)', () => {
    // open 12:00, earliest start 10:30 = exactly 90 min early
    const r = detectMismatches({ ...base, earliestStartAt: D('2026-05-25T09:30:00Z') }) // 10:30 BST
    expect(r.map(m => m.kind)).not.toContain('rota_before_open')
  })
  it('a shift starting 2h before open DOES trigger rota_before_open', () => {
    const r = detectMismatches({ ...base, earliestStartAt: D('2026-05-25T09:00:00Z') }) // 10:00 BST, 120 min early
    expect(r.map(m => m.kind)).toContain('rota_before_open')
  })
  it('latest end 21:00 vs 22:00 close -> no_cover_at_close', () => {
    const r = detectMismatches({ ...base, latestEndAt: D('2026-05-25T20:00:00Z') }) // 21:00 BST
    expect(r.map(m => m.kind)).toContain('no_cover_at_close')
  })
  it('null earliest/latest (nobody rostered) -> flags open and close cover gaps', () => {
    const r = detectMismatches({ ...base, earliestStartAt: null, latestEndAt: null })
    expect(r.map(m => m.kind).sort()).toEqual(['no_cover_at_close', 'no_cover_at_open'])
  })
})
