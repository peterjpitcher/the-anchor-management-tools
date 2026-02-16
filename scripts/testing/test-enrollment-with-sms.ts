#!/usr/bin/env tsx

import { createHash } from 'crypto'
import path from 'path'
import dotenv from 'dotenv'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'
import { ensureReplyInstruction } from '../../src/lib/sms/support'
import { sendSMS } from '../../src/lib/twilio'
import {
  assertTestEnrollmentWithSmsSendLimit,
  assertTestEnrollmentWithSmsSendAllowed,
  assertTestEnrollmentWithSmsTargets,
  isTestEnrollmentWithSmsRunEnabled,
  isTestEnrollmentWithSmsSendEnabled,
  readTestEnrollmentWithSmsCustomerId,
  readTestEnrollmentWithSmsLimit,
  readTestEnrollmentWithSmsToNumber
} from '../../src/lib/test-enrollment-with-sms-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

function normalizePhone(value: string): string {
  return value.replace(/\s+/g, '')
}

function buildWelcomeMessage(firstName: string, points: number): string {
  const safeName = firstName.trim() || 'there'
  return `Welcome to The Anchor VIP Club, ${safeName}! You've earned ${points} points. Start earning rewards at every visit!`
}

async function main() {
  const argv = process.argv.slice(2)
  const hasConfirmFlag = argv.includes('--confirm')
  const dryRunOverride = argv.includes('--dry-run')
  const sendEnabled = !dryRunOverride && isTestEnrollmentWithSmsSendEnabled(process.argv)
  const customerIdOverride = readTestEnrollmentWithSmsCustomerId(process.argv)
  const toOverride = readTestEnrollmentWithSmsToNumber(process.argv)
  const limitOverride = readTestEnrollmentWithSmsLimit(process.argv)

  if (hasConfirmFlag && !sendEnabled && !isTestEnrollmentWithSmsRunEnabled() && !dryRunOverride) {
    throw new Error('test-enrollment-with-sms blocked: --confirm requires RUN_TEST_ENROLLMENT_WITH_SMS_SEND=true.')
  }

  if (!sendEnabled) {
    const extra = dryRunOverride ? ' (--dry-run)' : ''
    console.log(
      `Read-only mode${extra}. Re-run with --confirm --limit=1 RUN_TEST_ENROLLMENT_WITH_SMS_SEND=true ALLOW_TEST_ENROLLMENT_WITH_SMS_SEND=true --customer-id=<uuid> --to=<number> to send one SMS.`
    )
    return
  }

  assertTestEnrollmentWithSmsSendAllowed()
  assertTestEnrollmentWithSmsSendLimit(limitOverride)

  const targets = assertTestEnrollmentWithSmsTargets({
    customerId: customerIdOverride,
    to: toOverride
  })

  const supabase = createAdminClient()

  const { data: customerData, error: customerError } = await supabase
    .from('customers')
    .select('id, first_name, mobile_number, sms_status')
    .eq('id', targets.customerId)
    .maybeSingle()

  const customer = assertScriptQuerySucceeded({
    operation: `Lookup customer ${targets.customerId}`,
    error: customerError,
    data: customerData as {
      id: string
      first_name: string | null
      mobile_number: string | null
      sms_status: string | null
    } | null,
    allowMissing: true,
  }) as
    | {
      id: string
      first_name: string | null
      mobile_number: string | null
      sms_status: string | null
    }
    | null

  if (!customer) {
    throw new Error('Customer not found.')
  }

  if (!customer.mobile_number) {
    throw new Error('Customer has no mobile number.')
  }

  const normalizedCustomerMobile = normalizePhone(customer.mobile_number)
  const normalizedTargetTo = normalizePhone(targets.to)

  if (normalizedCustomerMobile !== normalizedTargetTo) {
    throw new Error(
      `test-enrollment-with-sms blocked: --to must match the customer mobile number (${normalizedCustomerMobile}) to avoid accidental sends.`
    )
  }

  if (customer.sms_status && customer.sms_status !== 'active') {
    throw new Error(`Customer SMS status is ${customer.sms_status}; message not sent.`)
  }

  const points = 50
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const messageBody = ensureReplyInstruction(
    buildWelcomeMessage(customer.first_name || 'there', points),
    supportPhone
  )

  const stage = createHash('sha256').update(messageBody).digest('hex').slice(0, 16)
  const smsResult = await sendSMS(targets.to, messageBody, {
    customerId: customer.id,
    createCustomerIfMissing: false,
    metadata: {
      template_key: 'test_loyalty_enrollment_welcome_sms',
      trigger_type: 'test_loyalty_enrollment_welcome_sms',
      stage,
    }
  })

  if (!smsResult.success) {
    throw new Error(smsResult.error || 'SMS send failed')
  }

  console.log('✅ SMS dispatched (or suppressed/deferred by guards).')
  console.log('To:', targets.to)
  console.log('SID:', smsResult.sid || 'N/A')
  console.log('Status:', smsResult.status || 'N/A')
  if (smsResult.suppressed) {
    console.log('Suppressed:', smsResult.suppressionReason)
  }
  if (smsResult.deferred) {
    console.log('Deferred:', smsResult.deferredBy, smsResult.scheduledFor || '')
  }

  if ((smsResult as any).logFailure === true || (smsResult as any).code === 'logging_failed') {
    // Safety: transport succeeded but outbound message persistence failed, so safety limits may be unreliable.
    markFailure('SMS sent but outbound message logging failed (logging_failed).')
  }
}

main().catch((error) => {
  markFailure('test-enrollment-with-sms failed.', error)
})
