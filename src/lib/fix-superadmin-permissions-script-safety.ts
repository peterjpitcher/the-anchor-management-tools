import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

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

function parseOptionalPositiveInt(
  value: string | null | undefined,
  label: '--limit' | 'FIX_SUPERADMIN_PERMISSIONS_LIMIT'
): number | null {
  if (value == null || value === '') return null

  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`fix-superadmin-permissions blocked: ${label} must be a positive integer.`)
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`fix-superadmin-permissions blocked: ${label} must be a positive integer.`)
  }

  return parsed
}

function parseOptionalNonNegativeInt(
  value: string | null | undefined,
  label: '--offset' | 'FIX_SUPERADMIN_PERMISSIONS_OFFSET'
): number | null {
  if (value == null || value === '') return null

  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`fix-superadmin-permissions blocked: ${label} must be a non-negative integer.`)
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`fix-superadmin-permissions blocked: ${label} must be a non-negative integer.`)
  }

  return parsed
}

export function isFixSuperadminPermissionsMutationEnabled(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    argv.includes('--confirm') &&
    !argv.includes('--dry-run') &&
    isTruthyEnv(env.RUN_FIX_SUPERADMIN_PERMISSIONS_MUTATION)
  )
}

export function assertFixSuperadminPermissionsMutationAllowed(
  env: NodeJS.ProcessEnv = process.env
): void {
  // Support legacy allow env var name.
  if (isTruthyEnv(env.ALLOW_FIX_SUPERADMIN_PERMISSIONS_SCRIPT)) {
    return
  }

  assertScriptMutationAllowed({
    scriptName: 'fix-superadmin-permissions',
    envVar: 'ALLOW_FIX_SUPERADMIN_PERMISSIONS_MUTATION_SCRIPT'
  })
}

export function readFixSuperadminPermissionsLimit(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): number | null {
  return (
    parseOptionalPositiveInt(findFlagValue(argv, '--limit'), '--limit') ??
    parseOptionalPositiveInt(env.FIX_SUPERADMIN_PERMISSIONS_LIMIT, 'FIX_SUPERADMIN_PERMISSIONS_LIMIT')
  )
}

export function readFixSuperadminPermissionsOffset(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): number | null {
  return (
    parseOptionalNonNegativeInt(findFlagValue(argv, '--offset'), '--offset') ??
    parseOptionalNonNegativeInt(env.FIX_SUPERADMIN_PERMISSIONS_OFFSET, 'FIX_SUPERADMIN_PERMISSIONS_OFFSET')
  )
}

export function assertFixSuperadminPermissionsLimit(limit: number | null, hardCap: number): number {
  if (limit === null) {
    throw new Error('fix-superadmin-permissions blocked: --limit is required for --grant-all-missing.')
  }

  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('fix-superadmin-permissions blocked: --limit must be a positive integer.')
  }

  if (limit > hardCap) {
    throw new Error(
      `fix-superadmin-permissions blocked: --limit ${limit} exceeds hard cap ${hardCap}. Run in smaller batches.`
    )
  }

  return limit
}
