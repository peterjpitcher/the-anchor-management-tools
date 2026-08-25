import { describe, expect, it } from 'vitest'
import { getErrorMessage } from './errors'

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
