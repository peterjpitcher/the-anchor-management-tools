import { describe, expect, it } from 'vitest'
import {
  assertFixSuperadminPermissionsLimit,
  assertFixSuperadminPermissionsMutationAllowed,
  isFixSuperadminPermissionsMutationEnabled,
  readFixSuperadminPermissionsLimit,
  readFixSuperadminPermissionsOffset
} from '@/lib/fix-superadmin-permissions-script-safety'

describe('fix-superadmin-permissions script safety', () => {
  it('requires explicit confirm + RUN env to enable mutations', () => {
    expect(isFixSuperadminPermissionsMutationEnabled(['node', 'script'], {})).toBe(false)
    expect(isFixSuperadminPermissionsMutationEnabled(['node', 'script', '--confirm'], {})).toBe(false)
    expect(
      isFixSuperadminPermissionsMutationEnabled(['node', 'script', '--confirm'], {
        RUN_FIX_SUPERADMIN_PERMISSIONS_MUTATION: 'true'
      })
    ).toBe(true)
    expect(
      isFixSuperadminPermissionsMutationEnabled(['node', 'script', '--confirm', '--dry-run'], {
        RUN_FIX_SUPERADMIN_PERMISSIONS_MUTATION: 'true'
      })
    ).toBe(false)
  })

  it('blocks mutations unless ALLOW env var is enabled (supports legacy allow)', () => {
    const prevLegacy = process.env.ALLOW_FIX_SUPERADMIN_PERMISSIONS_SCRIPT
    const prevNew = process.env.ALLOW_FIX_SUPERADMIN_PERMISSIONS_MUTATION_SCRIPT
    delete process.env.ALLOW_FIX_SUPERADMIN_PERMISSIONS_SCRIPT
    delete process.env.ALLOW_FIX_SUPERADMIN_PERMISSIONS_MUTATION_SCRIPT

    expect(() => assertFixSuperadminPermissionsMutationAllowed()).toThrow(
      'fix-superadmin-permissions blocked by safety guard. Set ALLOW_FIX_SUPERADMIN_PERMISSIONS_MUTATION_SCRIPT=true to run this mutation script.'
    )

    process.env.ALLOW_FIX_SUPERADMIN_PERMISSIONS_MUTATION_SCRIPT = 'true'
    expect(() => assertFixSuperadminPermissionsMutationAllowed()).not.toThrow()
    delete process.env.ALLOW_FIX_SUPERADMIN_PERMISSIONS_MUTATION_SCRIPT

    process.env.ALLOW_FIX_SUPERADMIN_PERMISSIONS_SCRIPT = 'true'
    expect(() => assertFixSuperadminPermissionsMutationAllowed()).not.toThrow()

    if (prevLegacy === undefined) {
      delete process.env.ALLOW_FIX_SUPERADMIN_PERMISSIONS_SCRIPT
    } else {
      process.env.ALLOW_FIX_SUPERADMIN_PERMISSIONS_SCRIPT = prevLegacy
    }

    if (prevNew === undefined) {
      delete process.env.ALLOW_FIX_SUPERADMIN_PERMISSIONS_MUTATION_SCRIPT
    } else {
      process.env.ALLOW_FIX_SUPERADMIN_PERMISSIONS_MUTATION_SCRIPT = prevNew
    }
  })

  it('reads limit/offset from argv or env', () => {
    expect(readFixSuperadminPermissionsLimit(['node', 'script', '--limit', '12'], {})).toBe(12)
    expect(readFixSuperadminPermissionsLimit(['node', 'script', '--limit=9'], {})).toBe(9)
    expect(
      readFixSuperadminPermissionsLimit(['node', 'script'], {
        FIX_SUPERADMIN_PERMISSIONS_LIMIT: '7'
      })
    ).toBe(7)

    expect(readFixSuperadminPermissionsOffset(['node', 'script', '--offset', '3'], {})).toBe(3)
    expect(readFixSuperadminPermissionsOffset(['node', 'script', '--offset=5'], {})).toBe(5)
    expect(
      readFixSuperadminPermissionsOffset(['node', 'script'], {
        FIX_SUPERADMIN_PERMISSIONS_OFFSET: '11'
      })
    ).toBe(11)
  })

  it('fails closed on malformed limit/offset values', () => {
    expect(() =>
      readFixSuperadminPermissionsLimit(['node', 'script', '--limit=1e2'], {})
    ).toThrow('fix-superadmin-permissions blocked: --limit must be a positive integer.')
    expect(() =>
      readFixSuperadminPermissionsLimit(['node', 'script', '--limit=09'], {})
    ).toThrow('fix-superadmin-permissions blocked: --limit must be a positive integer.')
    expect(() =>
      readFixSuperadminPermissionsLimit(['node', 'script'], {
        FIX_SUPERADMIN_PERMISSIONS_LIMIT: 'abc'
      })
    ).toThrow('fix-superadmin-permissions blocked: FIX_SUPERADMIN_PERMISSIONS_LIMIT must be a positive integer.')

    expect(() =>
      readFixSuperadminPermissionsOffset(['node', 'script', '--offset=-1'], {})
    ).toThrow('fix-superadmin-permissions blocked: --offset must be a non-negative integer.')
    expect(() =>
      readFixSuperadminPermissionsOffset(['node', 'script', '--offset=01'], {})
    ).toThrow('fix-superadmin-permissions blocked: --offset must be a non-negative integer.')
    expect(() =>
      readFixSuperadminPermissionsOffset(['node', 'script'], {
        FIX_SUPERADMIN_PERMISSIONS_OFFSET: '1.5'
      })
    ).toThrow('fix-superadmin-permissions blocked: FIX_SUPERADMIN_PERMISSIONS_OFFSET must be a non-negative integer.')
  })

  it('enforces a hard cap for limit', () => {
    expect(() => assertFixSuperadminPermissionsLimit(null, 200)).toThrow('--limit is required')
    expect(() => assertFixSuperadminPermissionsLimit(0, 200)).toThrow('--limit must be a positive integer')
    expect(() => assertFixSuperadminPermissionsLimit(201, 200)).toThrow('exceeds hard cap')
    expect(assertFixSuperadminPermissionsLimit(50, 200)).toBe(50)
  })
})
