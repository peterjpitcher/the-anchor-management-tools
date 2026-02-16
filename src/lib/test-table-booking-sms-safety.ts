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
    throw new Error(`test-table-booking-sms blocked: invalid --limit value (${value}).`)
  }

  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`test-table-booking-sms blocked: invalid --limit value (${value}).`)
  }

  return parsed
}

export function isTestTableBookingSmsRunEnabled(): boolean {
  return isTruthyEnv(process.env.RUN_TEST_TABLE_BOOKING_SMS_SEND)
}

export function isTestTableBookingSmsSendEnabled(argv: string[] = process.argv): boolean {
  return argv.includes('--confirm') && isTestTableBookingSmsRunEnabled()
}

export function assertTestTableBookingSmsSendAllowed(): void {
  assertScriptMutationAllowed({
    scriptName: 'test-table-booking-sms',
    envVar: 'ALLOW_TEST_TABLE_BOOKING_SMS_SEND',
  })
}

export function readTestTableBookingSmsBookingId(argv: string[] = process.argv): string | null {
  return readOptionalFlagValue(argv, '--booking-id') ?? process.env.TEST_TABLE_BOOKING_SMS_BOOKING_ID ?? null
}

export function readTestTableBookingSmsToNumber(argv: string[] = process.argv): string | null {
  return readOptionalFlagValue(argv, '--to') ?? process.env.TEST_TABLE_BOOKING_SMS_TO ?? null
}

export function readTestTableBookingSmsLimit(argv: string[] = process.argv): number | null {
  return parsePositiveInt(readOptionalFlagValue(argv, '--limit'))
}

export function assertTestTableBookingSmsSendLimit(limit: number | null): number {
  if (limit === null) {
    throw new Error(`test-table-booking-sms blocked: missing --limit ${HARD_CAP} (explicit cap required).`)
  }

  if (limit > HARD_CAP) {
    throw new Error(`test-table-booking-sms blocked: --limit exceeds hard cap ${HARD_CAP}.`)
  }

  if (limit < HARD_CAP) {
    throw new Error(`test-table-booking-sms blocked: --limit must be ${HARD_CAP}.`)
  }

  return limit
}

export function assertTestTableBookingSmsTargets(params: {
  bookingId: string | null
  to: string | null
}): { bookingId: string; to: string } {
  const bookingId = params.bookingId?.trim() || ''
  if (!bookingId) {
    throw new Error('test-table-booking-sms blocked: --booking-id (or TEST_TABLE_BOOKING_SMS_BOOKING_ID) is required.')
  }

  const to = params.to?.trim() || ''
  if (!to) {
    throw new Error('test-table-booking-sms blocked: --to (or TEST_TABLE_BOOKING_SMS_TO) is required.')
  }

  return { bookingId, to }
}
