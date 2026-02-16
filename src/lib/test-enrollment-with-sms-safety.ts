import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const HARD_CAP = 1

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false
  }

  return TRUTHY.has(value.trim().toLowerCase())
}

function readOptionalFlagValue(argv: string[], flag: string): string | null {
  const eq = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (eq) {
    return eq.split('=')[1] ?? null
  }

  const idx = argv.findIndex((arg) => arg === flag)
  if (idx !== -1) {
    return argv[idx + 1] ?? null
  }

  return null
}

function parsePositiveInt(value: string | null): number | null {
  if (!value) {
    return null
  }

  const trimmed = String(value).trim()
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`test-enrollment-with-sms blocked: invalid --limit value (${value}).`)
  }

  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`test-enrollment-with-sms blocked: invalid --limit value (${value}).`)
  }

  return parsed
}

export function isTestEnrollmentWithSmsRunEnabled(): boolean {
  return isTruthyEnv(process.env.RUN_TEST_ENROLLMENT_WITH_SMS_SEND)
}

export function isTestEnrollmentWithSmsSendEnabled(argv: string[] = process.argv): boolean {
  return argv.includes('--confirm') && isTestEnrollmentWithSmsRunEnabled()
}

export function assertTestEnrollmentWithSmsSendAllowed(): void {
  assertScriptMutationAllowed({
    scriptName: 'test-enrollment-with-sms',
    envVar: 'ALLOW_TEST_ENROLLMENT_WITH_SMS_SEND',
  })
}

export function readTestEnrollmentWithSmsCustomerId(argv: string[] = process.argv): string | null {
  return (
    readOptionalFlagValue(argv, '--customer-id') ??
    process.env.TEST_ENROLLMENT_WITH_SMS_CUSTOMER_ID ??
    null
  )
}

export function readTestEnrollmentWithSmsToNumber(argv: string[] = process.argv): string | null {
  return readOptionalFlagValue(argv, '--to') ?? process.env.TEST_ENROLLMENT_WITH_SMS_TO ?? null
}

export function readTestEnrollmentWithSmsLimit(argv: string[] = process.argv): number | null {
  return parsePositiveInt(readOptionalFlagValue(argv, '--limit'))
}

export function assertTestEnrollmentWithSmsSendLimit(limit: number | null): number {
  if (limit === null) {
    throw new Error(`test-enrollment-with-sms blocked: missing --limit ${HARD_CAP} (explicit cap required).`)
  }

  if (limit > HARD_CAP) {
    throw new Error(`test-enrollment-with-sms blocked: --limit exceeds hard cap ${HARD_CAP}.`)
  }

  if (limit < HARD_CAP) {
    throw new Error(`test-enrollment-with-sms blocked: --limit must be ${HARD_CAP}.`)
  }

  return limit
}

export function assertTestEnrollmentWithSmsTargets(params: {
  customerId: string | null
  to: string | null
}): { customerId: string; to: string } {
  const customerId = params.customerId?.trim() || ''
  if (!customerId) {
    throw new Error(
      'test-enrollment-with-sms blocked: --customer-id (or TEST_ENROLLMENT_WITH_SMS_CUSTOMER_ID) is required.'
    )
  }

  const to = params.to?.trim() || ''
  if (!to) {
    throw new Error('test-enrollment-with-sms blocked: --to (or TEST_ENROLLMENT_WITH_SMS_TO) is required.')
  }

  return { customerId, to }
}
