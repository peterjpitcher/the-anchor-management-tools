import { describe, expect, it } from 'vitest'
import { smsFailureBadge } from '@/app/(authenticated)/settings/_shared/status-ui'

describe('the error badge on the SMS failures log', () => {
  it('shows the Twilio error code in red when there is one', () => {
    expect(smsFailureBadge('30003', 'undelivered')).toEqual({ label: '30003', tone: 'danger' })
  })

  it('words and colours a bare delivery status with the shared delivery map', () => {
    expect(smsFailureBadge(null, 'undelivered')).toEqual({ label: 'Not delivered', tone: 'danger' })
    expect(smsFailureBadge('', 'failed')).toEqual({ label: 'Failed', tone: 'danger' })
  })

  it('keeps a status the delivery map does not call a failure red, since every row here failed', () => {
    // The reconcile job marks a send Twilio has no record of as failed with twilio_status
    // 'not_found'. The shared map gives an unknown status grey; on this log it is still a failure.
    expect(smsFailureBadge(null, 'not_found')).toEqual({ label: 'Not found', tone: 'danger' })
  })

  it('shows nothing when Twilio gave neither', () => {
    expect(smsFailureBadge(null, null)).toBeNull()
  })
})
