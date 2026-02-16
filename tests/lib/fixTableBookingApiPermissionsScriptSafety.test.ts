import { describe, expect, it } from 'vitest'
import {
  assertFixTableBookingApiPermissionsLimit,
  assertFixTableBookingApiPermissionsKeyHash,
  assertFixTableBookingApiPermissionsMutationAllowed,
  isFixTableBookingApiPermissionsMutationEnabled,
  readFixTableBookingApiPermissionsLimit,
  readFixTableBookingApiPermissionsKeyHash
} from '@/lib/fix-table-booking-api-permissions-script-safety'

describe('fix-table-booking-api-permissions script safety', () => {
  it('requires explicit confirm + RUN env to enable mutations', () => {
    expect(isFixTableBookingApiPermissionsMutationEnabled(['node', 'script'], {})).toBe(false)
    expect(
      isFixTableBookingApiPermissionsMutationEnabled(['node', 'script', '--confirm'], {})
    ).toBe(false)
    expect(
      isFixTableBookingApiPermissionsMutationEnabled(
        ['node', 'script', '--confirm'],
        { RUN_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION: 'true' }
      )
    ).toBe(true)
    expect(
      isFixTableBookingApiPermissionsMutationEnabled(
        ['node', 'script', '--confirm', '--dry-run'],
        { RUN_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION: 'true' }
      )
    ).toBe(false)
  })

  it('blocks mutations unless ALLOW env var is enabled (supports legacy + new allow vars)', () => {
    const prevLegacy = process.env.ALLOW_FIX_TABLE_BOOKING_API_PERMISSIONS_SCRIPT
    const prevNew = process.env.ALLOW_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION_SCRIPT
    delete process.env.ALLOW_FIX_TABLE_BOOKING_API_PERMISSIONS_SCRIPT
    delete process.env.ALLOW_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION_SCRIPT

    expect(() => assertFixTableBookingApiPermissionsMutationAllowed()).toThrow(
      'fix-table-booking-api-permissions blocked by safety guard. Set ALLOW_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION_SCRIPT=true to run this mutation script.'
    )

    process.env.ALLOW_FIX_TABLE_BOOKING_API_PERMISSIONS_SCRIPT = 'true'
    expect(() => assertFixTableBookingApiPermissionsMutationAllowed()).not.toThrow()
    delete process.env.ALLOW_FIX_TABLE_BOOKING_API_PERMISSIONS_SCRIPT

    process.env.ALLOW_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION_SCRIPT = 'true'
    expect(() => assertFixTableBookingApiPermissionsMutationAllowed()).not.toThrow()

    if (prevLegacy === undefined) {
      delete process.env.ALLOW_FIX_TABLE_BOOKING_API_PERMISSIONS_SCRIPT
    } else {
      process.env.ALLOW_FIX_TABLE_BOOKING_API_PERMISSIONS_SCRIPT = prevLegacy
    }

    if (prevNew === undefined) {
      delete process.env.ALLOW_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION_SCRIPT
    } else {
      process.env.ALLOW_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION_SCRIPT = prevNew
    }
  })

  it('reads key hash from argv or env', () => {
    const hash = 'a'.repeat(64)
    expect(
      readFixTableBookingApiPermissionsKeyHash(['node', 'script', '--key-hash', hash], {})
    ).toBe(hash)
    expect(
      readFixTableBookingApiPermissionsKeyHash(['node', 'script', `--key-hash=${hash}`], {})
    ).toBe(hash)
    expect(
      readFixTableBookingApiPermissionsKeyHash(['node', 'script'], {
        FIX_TABLE_BOOKING_API_KEY_HASH: hash
      })
    ).toBe(hash)
  })

  it('validates key hash format', () => {
    expect(() => assertFixTableBookingApiPermissionsKeyHash(null)).toThrow('--key-hash is required')
    expect(() => assertFixTableBookingApiPermissionsKeyHash('not-a-hash')).toThrow(
      'sha256 hex string'
    )
    expect(assertFixTableBookingApiPermissionsKeyHash('A'.repeat(64))).toBe('a'.repeat(64))
  })

  it('reads mutation limit from argv or env', () => {
    expect(readFixTableBookingApiPermissionsLimit(['node', 'script', '--limit', '1'], {})).toBe('1')
    expect(
      readFixTableBookingApiPermissionsLimit(['node', 'script', '--limit=1'], {})
    ).toBe('1')
    expect(
      readFixTableBookingApiPermissionsLimit(['node', 'script'], {
        FIX_TABLE_BOOKING_API_PERMISSIONS_LIMIT: '1'
      })
    ).toBe('1')
  })

  it('requires a hard cap of --limit=1 in mutation mode', () => {
    expect(() => assertFixTableBookingApiPermissionsLimit(null)).toThrow('--limit is required')
    expect(() => assertFixTableBookingApiPermissionsLimit('0')).toThrow('--limit must be 1')
    expect(() => assertFixTableBookingApiPermissionsLimit('2')).toThrow('--limit must be 1')
    expect(assertFixTableBookingApiPermissionsLimit('1')).toBe(1)
  })
})
