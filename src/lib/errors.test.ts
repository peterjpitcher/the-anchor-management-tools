import { describe, expect, it } from 'vitest'
import { errorLogFields, getErrorMessage } from './errors'

describe('getErrorMessage', () => {
  it('reads messages from Supabase-style error objects', () => {
    expect(getErrorMessage({
      code: 'P0001',
      details: null,
      hint: null,
      message: 'A session for this site and date already exists.',
    })).toBe('A session for this site and date already exists.')
  })

  it('uses the safe fallback when no message is available', () => {
    expect(getErrorMessage({ code: 'P0001' })).toBe('An unexpected error occurred')
  })
})

describe('errorLogFields', () => {
  it('splits a supabase-js plain-object error into its fields', () => {
    expect(errorLogFields({ code: '42P01', message: 'relation missing', details: 'x', hint: 'y' })).toEqual({
      code: '42P01',
      message: 'relation missing',
      details: 'x',
      hint: 'y',
    })
  })

  it('handles an Error and a string', () => {
    expect(errorLogFields(new Error('boom'))).toEqual({ code: null, message: 'boom', details: null, hint: null })
    expect(errorLogFields('plain')).toEqual({ code: null, message: 'plain', details: null, hint: null })
  })
})
