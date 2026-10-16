import { describe, expect, it } from 'vitest'
import { checkBalanceContinuity, describeBalanceContinuity, type BalanceLine } from './statement-continuity'

type Move = [date: string, moneyIn: number, moneyOut: number]

/** Bank lines as the bank lists them: each with the balance after it. */
function statement(opening: number, moves: Move[]): BalanceLine[] {
  let balance = Math.round(opening * 100)
  return moves.map(([date, moneyIn, moneyOut]) => {
    balance += Math.round(moneyIn * 100) - Math.round(moneyOut * 100)
    return { date, amountIn: moneyIn || null, amountOut: moneyOut || null, balance: balance / 100 }
  })
}

const MAY_END: Move[] = [
  ['2026-05-26', 800, 0],
  ['2026-05-26', 0, 49.83],
  ['2026-05-27', 0, 113.78],
  ['2026-05-27', 2520, 0],
  ['2026-05-28', 0, 1047.5],
  ['2026-05-28', 0, 952.07],
  ['2026-05-28', 418.02, 0],
  ['2026-05-29', 0, 3.4],
  ['2026-05-29', 4038.64, 0],
]
const JUNE_START: Move[] = [
  ['2026-06-01', 0, 197],
  ['2026-06-01', 2611.92, 0],
  ['2026-06-02', 0, 38.99],
]

describe('checkBalanceContinuity', () => {
  it('joins up across days whatever order the lines arrive in', () => {
    const lines = statement(47227.62, [...MAY_END, ...JUNE_START])
    const shuffled = [...lines].reverse()
    shuffled.push(shuffled.shift()!)

    expect(checkBalanceContinuity(shuffled)).toEqual({ gaps: [], repeated: [], unchecked: 0 })
  })

  it('finds a line missing inside a day', () => {
    const lines = statement(47227.62, MAY_END)
    const withoutOne = lines.filter((line) => line.amountOut !== 1047.5)

    const result = checkBalanceContinuity(withoutOne)

    expect(result.gaps).toHaveLength(1)
    expect(result.gaps[0]).toMatchObject({ fromDate: '2026-05-27', toDate: '2026-05-28', missingNet: -1047.5 })
  })

  it('reports one stretch, with the true total, when a busy day loses two lines', () => {
    const lines = statement(47227.62, [...MAY_END, ...JUNE_START])
    const withoutTwo = lines.filter((line) => line.amountOut !== 1047.5 && line.amountIn !== 418.02)

    const result = checkBalanceContinuity(withoutTwo)

    expect(result.gaps).toHaveLength(1)
    expect(result.gaps[0].missingNet).toBe(-629.48)
  })

  it('finds the end of a month missing when only part of it was downloaded', () => {
    const lines = statement(47227.62, [...MAY_END, ...JUNE_START])
    const partMay = lines.filter((line) => !['2026-05-28', '2026-05-29'].includes(line.date))

    const result = checkBalanceContinuity(partMay)

    expect(result.gaps).toEqual([
      expect.objectContaining({ fromDate: '2026-05-27', toDate: '2026-06-01', missingNet: 2453.69 }),
    ])
  })

  it('finds a whole statement missing', () => {
    const lines = statement(1000, [
      ['2026-04-28', 0, 76.14],
      ['2026-05-14', 500, 0],
      ['2026-05-20', 0, 120],
      ['2026-06-03', 0, 50.8],
    ])
    const withoutMay = lines.filter((line) => !line.date.startsWith('2026-05'))

    const result = checkBalanceContinuity(withoutMay)

    expect(result.gaps).toEqual([
      expect.objectContaining({ fromDate: '2026-04-28', toDate: '2026-06-03', missingNet: 380 }),
    ])
  })

  it('does not call a same-day deposit and withdrawal of the same amount a gap', () => {
    const lines = statement(500, [
      ['2026-07-01', 0, 20],
      ['2026-07-02', 250, 0],
      ['2026-07-02', 0, 250],
      ['2026-07-02', 0, 12.99],
    ])

    expect(checkBalanceContinuity([...lines].reverse()).gaps).toEqual([])
  })

  it('keeps two genuine lines with the same date, amount and balance', () => {
    const lines = statement(100, [
      ['2026-07-03', 10, 0],
      ['2026-07-03', 0, 10],
      ['2026-07-03', 10, 0],
    ])

    expect(checkBalanceContinuity(lines)).toEqual({ gaps: [], repeated: [], unchecked: 0 })
  })

  it('reports a line held twice as a repeat, not as missing money', () => {
    const lines = statement(47227.62, MAY_END)
    const copy = { ...lines[4] }

    const result = checkBalanceContinuity([...lines, copy])

    expect(result.gaps).toEqual([])
    expect(result.repeated).toEqual([copy])
  })

  it('leaves lines without a balance out of the check', () => {
    const lines = statement(47227.62, MAY_END)

    const result = checkBalanceContinuity([...lines, { date: '2026-05-27', amountIn: 500, amountOut: null, balance: null }])

    expect(result).toEqual({ gaps: [], repeated: [], unchecked: 1 })
  })
})

describe('describeBalanceContinuity', () => {
  it('says nothing when the balance joins up', () => {
    expect(describeBalanceContinuity({ gaps: [], repeated: [], unchecked: 0 })).toBeNull()
  })

  it('names the dates and the money missing between two days', () => {
    const message = describeBalanceContinuity({
      gaps: [{ fromDate: '2026-05-27', fromBalance: 48072, toDate: '2026-06-01', toOpeningBalance: 46167.29, missingNet: -1904.71 }],
      repeated: [],
      unchecked: 0,
    })

    expect(message).toBe(
      'The bank balance does not join up, so some payments are probably missing: between 27 May 2026 and 1 June 2026, £1,904.71 more went out than the payments held show. Upload the full statement for those dates.'
    )
  })

  it('names a single day when the break is inside it, and money that came in', () => {
    const message = describeBalanceContinuity({
      gaps: [{ fromDate: '2026-07-03', fromBalance: 100, toDate: '2026-07-03', toOpeningBalance: 2560.9, missingNet: 2460.9 }],
      repeated: [],
      unchecked: 0,
    })

    expect(message).toContain('on 3 July 2026, £2,460.90 more came in than the payments held show')
  })

  it('lists three breaks and counts the rest', () => {
    const gap = { fromDate: '2026-08-01', fromBalance: 1, toDate: '2026-08-02', toOpeningBalance: 0, missingNet: -1 }

    const message = describeBalanceContinuity({ gaps: [gap, gap, gap, gap, gap], repeated: [], unchecked: 0 })

    expect(message).toContain('; and 2 more places.')
  })

  it('points out a repeated line', () => {
    const line = { date: '2026-07-28', amountIn: null, amountOut: 50.8, balance: 70850.56 }

    expect(describeBalanceContinuity({ gaps: [], repeated: [line], unchecked: 0 })).toBe(
      '1 payment is held twice with the same date, amount and balance. Check for a duplicate upload.'
    )
  })
})
