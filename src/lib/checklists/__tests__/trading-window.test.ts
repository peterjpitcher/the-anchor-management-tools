// src/lib/checklists/__tests__/trading-window.test.ts
import { describe, it, expect } from 'vitest'
import { coalesceTradingWindow } from '../trading-window'
import type { HoursRow } from '../types'

const h = (o: string | null, c: string | null, closed: boolean | null): HoursRow =>
  ({ opens: o, closes: c, is_closed: closed })

describe('coalesceTradingWindow (spec 5.1 truth table)', () => {
  it('no special row: uses business throughout', () => {
    expect(coalesceTradingWindow(null, h('16:00', '22:00', false)))
      .toEqual({ isClosed: false, opens: '16:00', closes: '22:00', source: 'business_hours' })
  })
  it('special is_closed=true: closed regardless of times', () => {
    expect(coalesceTradingWindow(h('12:00', '22:00', true), h('16:00', '22:00', false)))
      .toEqual({ isClosed: true, source: 'special_hours' })
  })
  it('special is_closed=false: open, times coalesce special over business', () => {
    expect(coalesceTradingWindow(h('12:00', null, false), h('16:00', '22:00', false)))
      .toEqual({ isClosed: false, opens: '12:00', closes: '22:00', source: 'special_hours' })
  })
  it('special is_closed=NULL, business closed: inherits closed', () => {
    expect(coalesceTradingWindow(h('12:00', null, null), h('16:00', '22:00', true)))
      .toEqual({ isClosed: true, source: 'business_hours' })
  })
  it('special is_closed=NULL, business open: open with special times', () => {
    expect(coalesceTradingWindow(h('12:00', null, null), h('16:00', '22:00', false)))
      .toEqual({ isClosed: false, opens: '12:00', closes: '22:00', source: 'special_hours' })
  })
  it('resolved open but a time is missing: no_hours', () => {
    expect(coalesceTradingWindow(null, h('16:00', null, false)))
      .toEqual({ resolved: false, reason: 'no_hours' })
  })
  it('opens equals closes: invalid_hours', () => {
    expect(coalesceTradingWindow(null, h('22:00', '22:00', false)))
      .toEqual({ resolved: false, reason: 'invalid_hours' })
  })
  it('both rows null: no_hours', () => {
    expect(coalesceTradingWindow(null, null)).toEqual({ resolved: false, reason: 'no_hours' })
  })
})
