import { describe, expect, it } from 'vitest'
import {
  assertParkingSmsBackfillLimit,
  assertParkingSmsBackfillMutationAllowed,
  assertParkingSmsBackfillRunEnabled,
  readParkingSmsBackfillLimit,
  readParkingSmsBackfillOffset
} from '@/lib/parking-sms-backfill-script-safety'

describe('parking SMS backfill script safety', () => {
  it('requires RUN_PARKING_SMS_BACKFILL_MUTATION=true before allowing mutation mode', () => {
    const previous = process.env.RUN_PARKING_SMS_BACKFILL_MUTATION
    delete process.env.RUN_PARKING_SMS_BACKFILL_MUTATION

    expect(() => assertParkingSmsBackfillRunEnabled()).toThrow(
      'parking-sms-backfill is in read-only mode. Set RUN_PARKING_SMS_BACKFILL_MUTATION=true and ALLOW_PARKING_SMS_BACKFILL_MUTATION=true to run mutations.'
    )

    process.env.RUN_PARKING_SMS_BACKFILL_MUTATION = 'true'
    expect(() => assertParkingSmsBackfillRunEnabled()).not.toThrow()

    if (previous === undefined) {
      delete process.env.RUN_PARKING_SMS_BACKFILL_MUTATION
    } else {
      process.env.RUN_PARKING_SMS_BACKFILL_MUTATION = previous
    }
  })

  it('requires an explicit ALLOW env var (supports legacy ALLOW_PARKING_SMS_BACKFILL_SCRIPT)', () => {
    const previousNew = process.env.ALLOW_PARKING_SMS_BACKFILL_MUTATION
    const previousLegacy = process.env.ALLOW_PARKING_SMS_BACKFILL_SCRIPT
    delete process.env.ALLOW_PARKING_SMS_BACKFILL_MUTATION
    delete process.env.ALLOW_PARKING_SMS_BACKFILL_SCRIPT

    expect(() => assertParkingSmsBackfillMutationAllowed()).toThrow(
      'parking-sms-backfill blocked by safety guard. Set ALLOW_PARKING_SMS_BACKFILL_MUTATION=true to run this mutation script.'
    )

    process.env.ALLOW_PARKING_SMS_BACKFILL_MUTATION = 'true'
    expect(() => assertParkingSmsBackfillMutationAllowed()).not.toThrow()

    delete process.env.ALLOW_PARKING_SMS_BACKFILL_MUTATION
    process.env.ALLOW_PARKING_SMS_BACKFILL_SCRIPT = 'true'
    expect(() => assertParkingSmsBackfillMutationAllowed()).not.toThrow()

    if (previousNew === undefined) {
      delete process.env.ALLOW_PARKING_SMS_BACKFILL_MUTATION
    } else {
      process.env.ALLOW_PARKING_SMS_BACKFILL_MUTATION = previousNew
    }

    if (previousLegacy === undefined) {
      delete process.env.ALLOW_PARKING_SMS_BACKFILL_SCRIPT
    } else {
      process.env.ALLOW_PARKING_SMS_BACKFILL_SCRIPT = previousLegacy
    }
  })

  it('enforces explicit caps with hard limits', () => {
    expect(() => assertParkingSmsBackfillLimit(0, 1000)).toThrow(
      'parking-sms-backfill blocked: limit must be a positive integer.'
    )

    expect(() => assertParkingSmsBackfillLimit(1001, 1000)).toThrow(
      'parking-sms-backfill blocked: limit 1001 exceeds hard cap 1000. Run in smaller batches.'
    )

    expect(() => assertParkingSmsBackfillLimit(10, 1000)).not.toThrow()
  })

  it('parses limit and offset flags from argv', () => {
    expect(readParkingSmsBackfillLimit(['node', 'script', '--limit', '25'])).toBe(25)
    expect(readParkingSmsBackfillLimit(['node', 'script', '--limit=30'])).toBe(30)
    expect(readParkingSmsBackfillOffset(['node', 'script', '--offset', '10'])).toBe(10)
    expect(readParkingSmsBackfillOffset(['node', 'script', '--offset=0'])).toBe(0)
  })
})

