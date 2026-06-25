import { describe, expect, it } from 'vitest'
import { buildMgdHmrcLines } from '../hmrcFormat'

describe('buildMgdHmrcLines', () => {
  it('uses the actual collection count and standard-rate totals', () => {
    const lines = buildMgdHmrcLines({
      total_net_take: 1000,
      total_mgd: 200,
      collection_count: 3,
    })

    expect(lines.find((line) => line.box === 1)?.value).toBe('3')
    expect(lines.find((line) => line.box === 4)?.value).toBe('£1000.00')
    expect(lines.find((line) => line.box === 5)?.value).toBe('£200.00')
    expect(lines.find((line) => line.box === 6)?.value).toBe('£0.00')
    expect(lines.find((line) => line.box === 7)?.value).toBe('£0.00')
  })

  it('puts five percent duty into the lower-rate boxes', () => {
    const lines = buildMgdHmrcLines({
      total_net_take: 1000,
      total_mgd: 50,
      collection_count: 2,
    })

    expect(lines.find((line) => line.box === 4)?.value).toBe('£0.00')
    expect(lines.find((line) => line.box === 5)?.value).toBe('£0.00')
    expect(lines.find((line) => line.box === 6)?.value).toBe('£1000.00')
    expect(lines.find((line) => line.box === 7)?.value).toBe('£50.00')
  })
})
