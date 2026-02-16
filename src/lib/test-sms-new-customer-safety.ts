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

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`test-sms-new-customer blocked: invalid --limit value (${value}).`)
  }

  return parsed
}

export function isTestSmsNewCustomerSendEnabled(argv: string[] = process.argv): boolean {
  return argv.includes('--confirm') && isTruthyEnv(process.env.RUN_TEST_SMS_NEW_CUSTOMER_SEND)
}

export function assertTestSmsNewCustomerSendAllowed(): void {
  assertScriptMutationAllowed({
    scriptName: 'test-sms-new-customer',
    envVar: 'ALLOW_TEST_SMS_NEW_CUSTOMER_SEND',
  })
}

export function readTestSmsNewCustomerLimit(argv: string[] = process.argv): number | null {
  return parsePositiveInt(readOptionalFlagValue(argv, '--limit'))
}

export function assertTestSmsNewCustomerSendLimit(limit: number | null): number {
  if (limit === null) {
    throw new Error(`test-sms-new-customer blocked: missing --limit ${HARD_CAP} (explicit cap required).`)
  }

  if (limit > HARD_CAP) {
    throw new Error(`test-sms-new-customer blocked: --limit exceeds hard cap ${HARD_CAP}.`)
  }

  if (limit < HARD_CAP) {
    throw new Error(`test-sms-new-customer blocked: --limit must be ${HARD_CAP}.`)
  }

  return limit
}

export function buildTestSmsNewCustomerMetadata(params: {
  now?: Date
}): Record<string, unknown> {
  const now = params.now ?? new Date()
  const stageBucket = Math.floor(now.getTime() / 5000)

  return {
    template_key: 'sms_diagnostic_new_customer',
    trigger_type: 'sms_diagnostic_new_customer',
    stage: `diagnostic:${stageBucket}`,
    source: 'script:test-sms-new-customer',
    test_script: 'test-sms-new-customer.ts',
    timestamp: now.toISOString(),
  }
}
