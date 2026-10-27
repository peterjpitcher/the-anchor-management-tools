import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * BK-019, customer bookings review of 24 October 2026: two capture paths recorded a deposit as
 * paid without reading the capture's own status, so a capture PayPal was holding for review
 * (PENDING) or had refused (DECLINED) counted as money taken. Both are server actions wired
 * into a page or a large actions file, so this checks their source (the table one now lives in the
 * shared capture service, src/lib/table-bookings/capture-deposit.ts): between the capture and
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
  it('the table deposit capture shared by the guest page and the website route', () => {
    const service = readFileSync(resolve(process.cwd(), 'src/lib/table-bookings/capture-deposit.ts'), 'utf8')
    expectOutcomeCheckedBeforeRecording(service, 'buildPayPalDepositCompletedUpdate(')
  })

  // BK-129: the two table deposit capture paths had drifted. Both must run the one service and
  // neither may capture on its own again.
  it.each([
    'src/app/g/[token]/table-payment/page.tsx',
    'src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts',
  ])('%s captures only through captureTableDeposit', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8')
    expect(source).toContain('captureTableDeposit(')
    expect(source).not.toContain('capturePayPalPayment(')
    expect(source).not.toContain('buildPayPalDepositCompletedUpdate(')
  })

  it('the staff private hire deposit capture', () => {
    const actions = readFileSync(resolve(process.cwd(), 'src/app/actions/privateBookingActions.ts'), 'utf8')
    const body = between(actions, 'export async function captureDepositPayment(', '\nexport async function ')
    expectOutcomeCheckedBeforeRecording(body, 'finalizeDepositPayment(')
  })

  // BK-063: the staff capture took the money before looking at the booking, so a cancelled hire
  // could be paid for, as the guest portal could. The status refusal must come before the capture.
  it('the staff private hire deposit capture refuses a closed booking before PayPal takes anything', () => {
    const actions = readFileSync(resolve(process.cwd(), 'src/app/actions/privateBookingActions.ts'), 'utf8')
    const body = between(actions, 'export async function captureDepositPayment(', '\nexport async function ')
    const refusal = body.indexOf("booking.status === 'cancelled' || booking.status === 'completed'")
    expect(refusal, 'closed booking refusal').toBeGreaterThan(0)
    expect(refusal).toBeLessThan(body.indexOf('capturePayPalPayment('))
    expect(body.slice(refusal, body.indexOf('capturePayPalPayment('))).toMatch(/return \{ error:/)
  })
})
