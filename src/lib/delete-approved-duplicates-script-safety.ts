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

function parseOptionalPositiveInt(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseOptionalNonNegativeInt(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function isDeleteApprovedDuplicatesMutationEnabled(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    argv.includes('--confirm') &&
    !argv.includes('--dry-run') &&
    isTruthyEnv(env.RUN_DELETE_APPROVED_DUPLICATES_MUTATION)
  )
}

export function assertDeleteApprovedDuplicatesMutationAllowed(
  env: NodeJS.ProcessEnv = process.env
): void {
  if (isTruthyEnv(env.ALLOW_DELETE_APPROVED_DUPLICATES_SCRIPT)) {
    return
  }

  assertScriptMutationAllowed({
    scriptName: 'delete-approved-duplicates',
    envVar: 'ALLOW_DELETE_APPROVED_DUPLICATES_MUTATION_SCRIPT'
  })
}

export function readDeleteApprovedDuplicatesLimit(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): number | null {
  return (
    parseOptionalPositiveInt(findFlagValue(argv, '--limit')) ??
    parseOptionalPositiveInt(env.DELETE_APPROVED_DUPLICATES_LIMIT)
  )
}

export function readDeleteApprovedDuplicatesOffset(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): number | null {
  return (
    parseOptionalNonNegativeInt(findFlagValue(argv, '--offset')) ??
    parseOptionalNonNegativeInt(env.DELETE_APPROVED_DUPLICATES_OFFSET)
  )
}

export function assertDeleteApprovedDuplicatesLimit(limit: number | null, hardCap: number): number {
  if (limit === null) {
    throw new Error('delete-approved-duplicates blocked: --limit is required in mutation mode.')
  }

  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('delete-approved-duplicates blocked: --limit must be a positive integer.')
  }

  if (limit > hardCap) {
    throw new Error(
      `delete-approved-duplicates blocked: --limit ${limit} exceeds hard cap ${hardCap}. Run in smaller batches.`
    )
  }

  return limit
}

