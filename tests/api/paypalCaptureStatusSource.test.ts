import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * BK-019, customer bookings review of 24 October 2026: two capture paths recorded a deposit as
 * paid without reading the capture's own status, so a capture PayPal was holding for review
 * (PENDING) or had refused (DECLINED) counted as money taken. Both are server actions wired
 * into a page or a large actions file, so this checks their source: between the capture and
 * the step that records the deposit, the capture's outcome must be read and anything but
 * `completed` must return.
 *
 * The other capture paths (website table and event routes, the guest event link, the private
 * hire portal, and the three reconciliation crons) are tested by behaviour in their own files.
 */

function between(source: string, from: string, to: string): string {
  const start = source.indexOf(from)
  expect(start, `${from} not found`).toBeGreaterThanOrEqual(0)
  const end = source.indexOf(to, start + from.length)
  return end < 0 ? source.slice(start) : source.slice(start, end)
}

function expectOutcomeCheckedBeforeRecording(body: string, recordStep: string) {
  const capture = body.indexOf('capturePayPalPayment(')
  const outcome = body.indexOf('payPalCaptureOutcome(')
  const record = body.indexOf(recordStep)
  expect(capture, 'capture call').toBeGreaterThan(0)
  expect(outcome, 'capture outcome is read after the capture').toBeGreaterThan(capture)
  expect(record, `${recordStep} comes after the outcome check`).toBeGreaterThan(outcome)
  expect(body.slice(outcome, record)).toMatch(/if \(captureOutcome !== 'completed'\) \{[\s\S]*?return/)
}

describe('deposit capture paths read the capture status before recording the deposit', () => {
  it('the guest table deposit page', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/app/g/[token]/table-payment/page.tsx'), 'utf8')
    expectOutcomeCheckedBeforeRecording(page, 'buildPayPalDepositCompletedUpdate(')
  })

  it('the staff private hire deposit capture', () => {
    const actions = readFileSync(resolve(process.cwd(), 'src/app/actions/privateBookingActions.ts'), 'utf8')
    const body = between(actions, 'export async function captureDepositPayment(', '\nexport async function ')
    expectOutcomeCheckedBeforeRecording(body, 'finalizeDepositPayment(')
  })
})
