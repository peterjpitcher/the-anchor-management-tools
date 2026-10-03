import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  attributionLabel,
  attributionNumber,
  attributionUrl,
  cleanAttributionLabel,
  cleanAttributionNumber,
  cleanAttributionUrl,
} from '@/lib/api/attribution-labels'

// Built at runtime so the source file holds no control or half characters.
const NUL = String.fromCharCode(0)
const LONE_SURROGATE = String.fromCharCode(0xd83d)
const EMOJI = String.fromCodePoint(0x1f600)

describe('cleanAttributionLabel', () => {
  it('keeps a good label, trimmed', () => {
    expect(cleanAttributionLabel('facebook', 20)).toBe('facebook')
    expect(cleanAttributionLabel('  facebook  ', 20)).toBe('facebook')
  })

  it('cuts a long label to its cap, after trimming', () => {
    expect(cleanAttributionLabel(`  ${'x'.repeat(50)}  `, 20)).toBe('x'.repeat(20))
    expect(cleanAttributionLabel('x'.repeat(20), 20)).toBe('x'.repeat(20))
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['a boolean', false],
    ['an object', { nested: 'value' }],
    ['an array', ['facebook']],
    ['an empty string', ''],
    ['a blank string', '   '],
  ])('treats %s as not sent', (_description, value) => {
    expect(cleanAttributionLabel(value, 20)).toBeUndefined()
  })

  it('drops a label Postgres jsonb cannot store', () => {
    expect(cleanAttributionLabel(`quiz${NUL}night`, 20)).toBeUndefined()
    expect(cleanAttributionLabel(`quiz ${LONE_SURROGATE}`, 20)).toBeUndefined()
    // The cut lands in the middle of the emoji and would leave half of it behind.
    expect(cleanAttributionLabel(`${'c'.repeat(19)}${EMOJI}`, 20)).toBeUndefined()
  })

  it('keeps a whole emoji', () => {
    expect(cleanAttributionLabel(`quiz ${EMOJI}`, 20)).toBe(`quiz ${EMOJI}`)
  })
})

describe('cleanAttributionUrl', () => {
  it('keeps a web address', () => {
    expect(cleanAttributionUrl(' https://www.example.com/events/quiz-night?utm_source=facebook ', 200))
      .toBe('https://www.example.com/events/quiz-night?utm_source=facebook')
  })

  it('cuts a long web address to its cap', () => {
    const longUrl = `https://www.example.com/events?utm_content=${'c'.repeat(500)}`
    expect(cleanAttributionUrl(longUrl, 100)).toBe(longUrl.slice(0, 100))
  })

  it.each([
    ['not a web address', 'not a web address'],
    ['a bare path', '/events/quiz-night'],
    ['null', null],
    ['a number', 42],
    ['a blank string', '   '],
  ])('treats %s as not sent', (_description, value) => {
    expect(cleanAttributionUrl(value, 200)).toBeUndefined()
  })
})

describe('cleanAttributionNumber', () => {
  it.each([0, 5, 12.5])('keeps %s', (value) => {
    expect(cleanAttributionNumber(value)).toBe(value)
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a numeric string', '12.50'],
    ['a negative number', -1],
    ['not a number', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['a boolean', true],
    ['an array', [5]],
  ])('treats %s as not sent', (_description, value) => {
    expect(cleanAttributionNumber(value)).toBeUndefined()
  })
})

describe('the schema fields', () => {
  const Schema = z.object({
    seats: z.number().int().min(1),
    utm_source: attributionLabel(10),
    source_url: attributionUrl(100),
    event_price: attributionNumber(),
  })

  it('never fails the parse over a bad label, and leaves the bad label out', () => {
    const parsed = Schema.safeParse({ seats: 2, utm_source: null, source_url: 42, event_price: 'free' })

    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ seats: 2 })
  })

  it('still fails the parse over a real field, whatever the labels are', () => {
    const parsed = Schema.safeParse({ seats: 0, utm_source: 'facebook', source_url: 'https://www.example.com/', event_price: 5 })

    expect(parsed.success).toBe(false)
  })
})
