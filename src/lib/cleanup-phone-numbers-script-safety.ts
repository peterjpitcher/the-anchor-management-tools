import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false
  }

  return TRUTHY.has(value.trim().toLowerCase())
}

export function isCleanupPhoneNumbersRunEnabled(): boolean {
  return isTruthyEnv(process.env.RUN_CLEANUP_PHONE_NUMBERS_MUTATION)
}

export function assertCleanupPhoneNumbersRunEnabled(): void {
  if (isCleanupPhoneNumbersRunEnabled()) {
    return
  }

  throw new Error(
    'cleanup-phone-numbers is in read-only mode. Set RUN_CLEANUP_PHONE_NUMBERS_MUTATION=true and ALLOW_CLEANUP_PHONE_NUMBERS_MUTATION=true to run mutations.'
  )
}

export function assertCleanupPhoneNumbersMutationAllowed(): void {
  // Backwards-compatible allow flag for older usages.
  if (isTruthyEnv(process.env.ALLOW_CLEANUP_PHONE_NUMBERS_SCRIPT)) {
    return
  }

  assertScriptMutationAllowed({
    scriptName: 'cleanup-phone-numbers',
    envVar: 'ALLOW_CLEANUP_PHONE_NUMBERS_MUTATION'
  })
}

function parseOptionalPositiveInt(value: string | undefined): number | null {
  if (!value) {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

export function readCleanupPhoneNumbersLimit(argv: string[] = process.argv): number | null {
  const eq = argv.find((arg) => arg.startsWith('--limit='))
  if (eq) {
    return parseOptionalPositiveInt(eq.split('=')[1])
  }

  const idx = argv.findIndex((arg) => arg === '--limit')
  if (idx !== -1) {
    return parseOptionalPositiveInt(argv[idx + 1])
  }

  return parseOptionalPositiveInt(process.env.CLEANUP_PHONE_NUMBERS_LIMIT)
}

export function assertCleanupPhoneNumbersLimit(limit: number, max: number): void {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('cleanup-phone-numbers blocked: limit must be a positive integer.')
  }

  if (limit > max) {
    throw new Error(
      `cleanup-phone-numbers blocked: limit ${limit} exceeds hard cap ${max}. Run in smaller batches.`
    )
  }
}

