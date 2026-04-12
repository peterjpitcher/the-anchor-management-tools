import { describe, it, expect } from 'vitest'
import { isPlaceholderName, getSmartFirstName, buildSmartFullName } from '@/lib/sms/name-utils'

describe('isPlaceholderName', () => {
  it('returns true for null', () => {
    expect(isPlaceholderName(null)).toBe(true)
  })

  it('returns true for undefined', () => {
    expect(isPlaceholderName(undefined)).toBe(true)
  })

  it('returns true for empty string', () => {
    expect(isPlaceholderName('')).toBe(true)
  })

  it('returns true for whitespace-only string', () => {
    expect(isPlaceholderName('   ')).toBe(true)
  })

  it.each([
    'unknown',
    'guest',
    'customer',
    'client',
    'user',
    'admin',
  ])('returns true for placeholder name "%s"', (name) => {
    expect(isPlaceholderName(name)).toBe(true)
  })

  it.each([
    'Unknown',
    'GUEST',
    'Customer',
    'CLIENT',
    'User',
    'ADMIN',
  ])('returns true for case-insensitive placeholder "%s"', (name) => {
    expect(isPlaceholderName(name)).toBe(true)
  })

  it.each([
    '  unknown  ',
    '  guest ',
    ' admin  ',
  ])('returns true for whitespace-padded placeholder "%s"', (name) => {
    expect(isPlaceholderName(name)).toBe(true)
  })

  it.each([
    'Peter',
    'Christina',
    'Sarah',
    'John',
    'guestbook',
    'administrator',
    'superuser',
  ])('returns false for real name "%s"', (name) => {
    expect(isPlaceholderName(name)).toBe(false)
  })
})

describe('getSmartFirstName', () => {
  it.each([
    ['Peter', 'Peter'],
    ['  Sarah  ', 'Sarah'],
    ['John', 'John'],
  ])('passes through real name "%s" as "%s"', (input, expected) => {
    expect(getSmartFirstName(input)).toBe(expected)
  })

  it.each([
    [null, 'there'],
    [undefined, 'there'],
    ['', 'there'],
    ['  ', 'there'],
    ['unknown', 'there'],
    ['Guest', 'there'],
    ['CUSTOMER', 'there'],
    ['  admin  ', 'there'],
  ])('returns "there" for placeholder input %s', (input, expected) => {
    expect(getSmartFirstName(input as string | null | undefined)).toBe(expected)
  })
})

describe('buildSmartFullName', () => {
  it('returns "First Last" when both are real names', () => {
    expect(buildSmartFullName('Peter', 'Smith')).toBe('Peter Smith')
  })

  it('returns first name only when last name is placeholder', () => {
    expect(buildSmartFullName('Peter', 'unknown')).toBe('Peter')
  })

  it('returns first name only when last name is null', () => {
    expect(buildSmartFullName('Peter', null)).toBe('Peter')
  })

  it('returns last name only when first name is placeholder', () => {
    expect(buildSmartFullName('guest', 'Smith')).toBe('Smith')
  })

  it('returns "Customer" when both are placeholders', () => {
    expect(buildSmartFullName('unknown', 'guest')).toBe('Customer')
  })

  it('returns "Customer" when both are null', () => {
    expect(buildSmartFullName(null, null)).toBe('Customer')
  })

  it('trims whitespace from names', () => {
    expect(buildSmartFullName('  Peter  ', '  Smith  ')).toBe('Peter Smith')
  })
})
