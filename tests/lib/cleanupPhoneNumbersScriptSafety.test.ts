import { describe, expect, it } from 'vitest'
import {
  assertCleanupPhoneNumbersLimit,
  assertCleanupPhoneNumbersMutationAllowed,
  assertCleanupPhoneNumbersRunEnabled,
  readCleanupPhoneNumbersLimit
} from '@/lib/cleanup-phone-numbers-script-safety'

describe('cleanup phone numbers script safety', () => {
  it('blocks run when RUN_CLEANUP_PHONE_NUMBERS_MUTATION is missing', () => {
    const previous = process.env.RUN_CLEANUP_PHONE_NUMBERS_MUTATION
    delete process.env.RUN_CLEANUP_PHONE_NUMBERS_MUTATION

    expect(() => assertCleanupPhoneNumbersRunEnabled()).toThrow(
      'cleanup-phone-numbers is in read-only mode. Set RUN_CLEANUP_PHONE_NUMBERS_MUTATION=true and ALLOW_CLEANUP_PHONE_NUMBERS_MUTATION=true to run mutations.'
    )

    if (previous === undefined) {
      delete process.env.RUN_CLEANUP_PHONE_NUMBERS_MUTATION
    } else {
      process.env.RUN_CLEANUP_PHONE_NUMBERS_MUTATION = previous
    }
  })

  it('blocks mutation when allow env vars are missing', () => {
    const previousAllow = process.env.ALLOW_CLEANUP_PHONE_NUMBERS_MUTATION
    const previousLegacy = process.env.ALLOW_CLEANUP_PHONE_NUMBERS_SCRIPT
    delete process.env.ALLOW_CLEANUP_PHONE_NUMBERS_MUTATION
    delete process.env.ALLOW_CLEANUP_PHONE_NUMBERS_SCRIPT

    expect(() => assertCleanupPhoneNumbersMutationAllowed()).toThrow(
      'cleanup-phone-numbers blocked by safety guard. Set ALLOW_CLEANUP_PHONE_NUMBERS_MUTATION=true to run this mutation script.'
    )

    if (previousAllow === undefined) {
      delete process.env.ALLOW_CLEANUP_PHONE_NUMBERS_MUTATION
    } else {
      process.env.ALLOW_CLEANUP_PHONE_NUMBERS_MUTATION = previousAllow
    }

    if (previousLegacy === undefined) {
      delete process.env.ALLOW_CLEANUP_PHONE_NUMBERS_SCRIPT
    } else {
      process.env.ALLOW_CLEANUP_PHONE_NUMBERS_SCRIPT = previousLegacy
    }
  })

  it('allows mutation when legacy allow flag is set', () => {
    const previousAllow = process.env.ALLOW_CLEANUP_PHONE_NUMBERS_MUTATION
    const previousLegacy = process.env.ALLOW_CLEANUP_PHONE_NUMBERS_SCRIPT
    delete process.env.ALLOW_CLEANUP_PHONE_NUMBERS_MUTATION
    process.env.ALLOW_CLEANUP_PHONE_NUMBERS_SCRIPT = 'true'

    expect(() => assertCleanupPhoneNumbersMutationAllowed()).not.toThrow()

    if (previousAllow === undefined) {
      delete process.env.ALLOW_CLEANUP_PHONE_NUMBERS_MUTATION
    } else {
      process.env.ALLOW_CLEANUP_PHONE_NUMBERS_MUTATION = previousAllow
    }

    if (previousLegacy === undefined) {
      delete process.env.ALLOW_CLEANUP_PHONE_NUMBERS_SCRIPT
    } else {
      process.env.ALLOW_CLEANUP_PHONE_NUMBERS_SCRIPT = previousLegacy
    }
  })

  it('reads limit from argv and env', () => {
    const previous = process.env.CLEANUP_PHONE_NUMBERS_LIMIT

    expect(readCleanupPhoneNumbersLimit(['node', 'script', '--limit=12'])).toBe(12)
    expect(readCleanupPhoneNumbersLimit(['node', 'script', '--limit', '13'])).toBe(13)
    expect(readCleanupPhoneNumbersLimit(['node', 'script', '--limit', '0'])).toBeNull()

    process.env.CLEANUP_PHONE_NUMBERS_LIMIT = '21'
    expect(readCleanupPhoneNumbersLimit(['node', 'script'])).toBe(21)

    if (previous === undefined) {
      delete process.env.CLEANUP_PHONE_NUMBERS_LIMIT
    } else {
      process.env.CLEANUP_PHONE_NUMBERS_LIMIT = previous
    }
  })

  it('enforces explicit capped limits', () => {
    expect(() => assertCleanupPhoneNumbersLimit(0, 500)).toThrow(
      'cleanup-phone-numbers blocked: limit must be a positive integer.'
    )
    expect(() => assertCleanupPhoneNumbersLimit(501, 500)).toThrow(
      'cleanup-phone-numbers blocked: limit 501 exceeds hard cap 500. Run in smaller batches.'
    )
    expect(() => assertCleanupPhoneNumbersLimit(10, 500)).not.toThrow()
  })
})

