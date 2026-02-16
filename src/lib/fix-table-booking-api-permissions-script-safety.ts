import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const FIX_TABLE_BOOKING_API_PERMISSIONS_LIMIT = 1

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.trim().toLowerCase())
}

function findFlagValue(argv: string[], flag: string): string | null {
  const withEqualsPrefix = `${flag}=`
  for (let i = 0; i < argv.length; i += 1) {
    const entry = argv[i]
    if (entry === flag) {
      const next = argv[i + 1]
      return typeof next === 'string' ? next : null
    }
    if (typeof entry === 'string' && entry.startsWith(withEqualsPrefix)) {
      return entry.slice(withEqualsPrefix.length)
    }
  }
  return null
}

export function isFixTableBookingApiPermissionsMutationEnabled(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    argv.includes('--confirm') &&
    !argv.includes('--dry-run') &&
    isTruthyEnv(env.RUN_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION)
  )
}

export function assertFixTableBookingApiPermissionsMutationAllowed(
  env: NodeJS.ProcessEnv = process.env
): void {
  if (isTruthyEnv(env.ALLOW_FIX_TABLE_BOOKING_API_PERMISSIONS_SCRIPT)) {
    return
  }

  assertScriptMutationAllowed({
    scriptName: 'fix-table-booking-api-permissions',
    envVar: 'ALLOW_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION_SCRIPT'
  })
}

export function readFixTableBookingApiPermissionsKeyHash(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  return findFlagValue(argv, '--key-hash') ?? env.FIX_TABLE_BOOKING_API_KEY_HASH ?? null
}

export function readFixTableBookingApiPermissionsLimit(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  return findFlagValue(argv, '--limit') ?? env.FIX_TABLE_BOOKING_API_PERMISSIONS_LIMIT ?? null
}

export function assertFixTableBookingApiPermissionsKeyHash(value: string | null): string {
  if (!value) {
    throw new Error('fix-table-booking-api-permissions blocked: --key-hash is required.')
  }

  const normalized = value.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(
      'fix-table-booking-api-permissions blocked: --key-hash must be a sha256 hex string (64 hex characters).'
    )
  }

  return normalized
}

export function assertFixTableBookingApiPermissionsLimit(value: string | null): number {
  if (!value) {
    throw new Error(
      `fix-table-booking-api-permissions blocked: --limit is required in mutation mode (expected --limit=${FIX_TABLE_BOOKING_API_PERMISSIONS_LIMIT}).`
    )
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed !== FIX_TABLE_BOOKING_API_PERMISSIONS_LIMIT) {
    throw new Error(
      `fix-table-booking-api-permissions blocked: --limit must be ${FIX_TABLE_BOOKING_API_PERMISSIONS_LIMIT} in mutation mode.`
    )
  }

  return parsed
}
