import { describe, expect, it } from 'vitest'
import { buildMgdHmrcLines } from '../hmrcFormat'

describe('buildMgdHmrcLines', () => {
  it('uses the configured machine count and standard-rate totals', () => {
    const lines = buildMgdHmrcLines({
      total_net_take: 1000,
      total_mgd: 200,
      machine_count: 3,
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
      machine_count: 2,
    })

    expect(lines.find((line) => line.box === 4)?.value).toBe('£0.00')
    expect(lines.find((line) => line.box === 5)?.value).toBe('£0.00')
    expect(lines.find((line) => line.box === 6)?.value).toBe('£1000.00')
    expect(lines.find((line) => line.box === 7)?.value).toBe('£50.00')
  })

  it('reports the exact amount to the penny without rounding to whole pounds', () => {
    const lines = buildMgdHmrcLines({
      total_net_take: 1234.56,
      total_mgd: 246.91,
      machine_count: 4,
    })

    // Standard-rate boxes carry the exact pennies...
    expect(lines.find((line) => line.box === 4)?.value).toBe('£1234.56')
    expect(lines.find((line) => line.box === 5)?.value).toBe('£246.91')
    // ...and the duty payable / net duty payable (the amount paid to HMRC) too.
    expect(lines.find((line) => line.box === 8)?.value).toBe('£246.91')
    expect(lines.find((line) => line.box === 12)?.value).toBe('£246.91')
  })

  it('keeps a true 20% return in the standard-rate boxes despite penny-level rate drift', () => {
    // 6.67 / 33.33 = 0.20012 — a genuine standard-rate collection whose ratio
    // drifts just above 0.20 once amounts are kept to the penny.
    const lines = buildMgdHmrcLines({
      total_net_take: 33.33,
      total_mgd: 6.67,
      machine_count: 1,
    })

    expect(lines.find((line) => line.box === 2)?.value).toBe('£0.00') // not higher rate
    expect(lines.find((line) => line.box === 3)?.value).toBe('£0.00')
    expect(lines.find((line) => line.box === 4)?.value).toBe('£33.33')
    expect(lines.find((line) => line.box === 5)?.value).toBe('£6.67')
  })
})
