import { describe, expect, it } from 'vitest'
import { MAX_ATTENDEE_NAME_LENGTH, normalizeAttendeeNames } from './attendee-names'

describe('normalizeAttendeeNames', () => {
  it('treats undefined/null as not provided (valid, empty)', () => {
    expect(normalizeAttendeeNames(undefined, 3)).toEqual({ ok: true, names: [] })
    expect(normalizeAttendeeNames(null, 1)).toEqual({ ok: true, names: [] })
  })

  it('trims each name and keeps order (booker is index 0)', () => {
    const result = normalizeAttendeeNames(['  Alice Booker ', 'Bob Guest'], 2)
    expect(result).toEqual({ ok: true, names: ['Alice Booker', 'Bob Guest'] })
  })

  it('rejects a blank or whitespace-only name', () => {
    const result = normalizeAttendeeNames(['Alice', '   '], 2)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/each ticket needs a name/i)
  })

  it('rejects when the count does not match seats', () => {
    const result = normalizeAttendeeNames(['Alice', 'Bob'], 3)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/expected 3 ticket names but received 2/i)
  })

  it('uses singular wording for a single missing name', () => {
    const result = normalizeAttendeeNames([], 1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/expected 1 ticket name but received 0/i)
  })

  it('rejects a name longer than the maximum', () => {
    const result = normalizeAttendeeNames(['A'.repeat(MAX_ATTENDEE_NAME_LENGTH + 1)], 1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/characters or fewer/i)
  })

  it('rejects a non-array input', () => {
    const result = normalizeAttendeeNames('Alice' as unknown, 1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/must be an array/i)
  })

  it('coerces non-string entries to blank and rejects them', () => {
    const result = normalizeAttendeeNames(['Alice', 42 as unknown as string], 2)
    expect(result.ok).toBe(false)
  })
})
