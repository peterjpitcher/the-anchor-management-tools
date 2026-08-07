import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { formBooleanSchema, formBooleanWithDefault } from '../formBoolean'

describe('formBooleanSchema', () => {
  it('reads the string "false" as false, which z.coerce.boolean does not', () => {
    // The regression this guards: Boolean('false') is true, so an unticked
    // checkbox sent as String(false) used to arrive as true.
    expect(z.coerce.boolean().parse('false')).toBe(true)
    expect(formBooleanSchema.parse('false')).toBe(false)
  })

  it('handles the values a form can realistically send', () => {
    for (const truthy of ['true', 'on', 'yes', '1', 'TRUE', ' true ', true]) {
      expect(formBooleanSchema.parse(truthy)).toBe(true)
    }
    for (const falsy of ['false', 'off', 'no', '0', 'FALSE', ' false ', false]) {
      expect(formBooleanSchema.parse(falsy)).toBe(false)
    }
  })

  it('leaves absent values undefined so the caller keeps the default', () => {
    expect(formBooleanSchema.parse(undefined)).toBeUndefined()
    expect(formBooleanSchema.parse(null)).toBeUndefined()
    expect(formBooleanSchema.parse('')).toBeUndefined()
  })

  it('rejects anything it cannot interpret rather than guessing', () => {
    expect(formBooleanSchema.safeParse('maybe').success).toBe(false)
    expect(formBooleanSchema.safeParse(7).success).toBe(false)
  })
})

describe('formBooleanWithDefault', () => {
  it('applies the default only when the field is absent', () => {
    expect(formBooleanWithDefault(true).parse(undefined)).toBe(true)
    expect(formBooleanWithDefault(true).parse('false')).toBe(false)
    expect(formBooleanWithDefault(false).parse('on')).toBe(true)
  })
})
