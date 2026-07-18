// src/lib/checklists/__tests__/spot-draw.test.ts
import { describe, it, expect } from 'vitest'
import { drawSpotChecks, type DrawCandidate } from '../spot-draw'

const c = (instanceId: string, templateId: string): DrawCandidate => ({ instanceId, templateId })

describe('drawSpotChecks (spec 11)', () => {
  it('rng returning 0 picks the highest-weight (least-recently-checked) candidate first', () => {
    const candidates = [c('i-a', 't-a'), c('i-b', 't-b')]
    // t-a checked 5 times recently (low weight), t-b never (high weight)
    const chosen = drawSpotChecks(candidates, { 't-a': 5, 't-b': 0 }, 1, () => 0)
    expect(chosen).toEqual(['i-b'])
  })
  it('fewer candidates than count -> returns all of them', () => {
    const chosen = drawSpotChecks([c('i-a', 't-a')], {}, 2, () => 0.5)
    expect(chosen).toEqual(['i-a'])
  })
  it('no repeated instanceId in the returned set', () => {
    const candidates = [c('i-a', 't-a'), c('i-b', 't-b'), c('i-c', 't-c')]
    const chosen = drawSpotChecks(candidates, {}, 2, mkRng([0.1, 0.9, 0.4, 0.2]))
    expect(new Set(chosen).size).toBe(chosen.length)
    expect(chosen).toHaveLength(2)
  })
  it('deterministic for a fixed rng sequence', () => {
    const candidates = [c('i-a', 't-a'), c('i-b', 't-b'), c('i-c', 't-c')]
    const r1 = drawSpotChecks(candidates, {}, 2, mkRng([0.1, 0.9, 0.4, 0.2]))
    const r2 = drawSpotChecks(candidates, {}, 2, mkRng([0.1, 0.9, 0.4, 0.2]))
    expect(r1).toEqual(r2)
  })
  it('empty candidates -> empty', () => {
    expect(drawSpotChecks([], {}, 2, () => 0)).toEqual([])
  })
})

function mkRng(seq: number[]): () => number {
  let i = 0
  return () => seq[i++ % seq.length]
}
