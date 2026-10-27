import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * A ticket holder's own mobile is kept to that booking only (BK-013, customer bookings review of
 * 24 October 2026; owner decision D5). It is somebody else's number, given by the booker, so it is
 * never texted, never emailed about, never used for marketing and never copied to the customers
 * table.
 *
 * Guest phones live in bookings.attendees[].phone. Only the guest details modules, the staff
 * editor, the booker's manage link, the door list, the guest answers export and the retention
 * job may read them. This guard fails when any messaging, marketing or customer module reads a
 * guest's phone, or when any file passes one to ensureCustomerForPhone or sendSMS.
 */
const ROOT = process.cwd()

/** Folders and files that send messages, build audiences or write customer records. */
const MESSAGE_PATHS = [
  'src/lib/sms',
  'src/lib/email',
  'src/lib/twilio.ts',
  'src/lib/event-marketing-links.ts',
  'src/lib/event-promotion-validation.ts',
  'src/lib/manual-review-campaign-safety.ts',
  'src/lib/events/event-payments.ts',
  'src/lib/events/reschedule-notifications.ts',
  'src/lib/events/waitlist-offers.ts',
  'src/services/sms-queue.ts',
  'src/services/customers.ts',
  'src/app/api/cron',
]

/** A guest row's phone: attendee.phone, guest.phone, attendees[0].phone, attendees?.[i]?.phone. */
const GUEST_PHONE = /\b(attendee|attendees|guest|guests)(\?\.)?(\[[^\]]*\])?(\?)?\.phone\b|['"]phone['"]\s*\]\s*.*attendees|attendees.*\[\s*['"]phone['"]\s*\]/

function files(path: string, out: string[] = []): string[] {
  const full = join(ROOT, path)
  let stat
  try { stat = statSync(full) } catch { return out }
  if (stat.isDirectory()) {
    for (const name of readdirSync(full)) {
      if (name === '__tests__' || name === 'node_modules') continue
      files(join(path, name), out)
    }
  } else if (/\.(ts|tsx)$/.test(path) && !/\.test\.tsx?$/.test(path)) {
    out.push(path)
  }
  return out
}

function readersIn(paths: string[], pattern: RegExp): string[] {
  const hits: string[] = []
  for (const file of paths.flatMap((path) => files(path))) {
    const lines = readFileSync(join(ROOT, file), 'utf8').split('\n')
    lines.forEach((line, index) => {
      if (pattern.test(line)) hits.push(`${relative(ROOT, join(ROOT, file))}:${index + 1}: ${line.trim()}`)
    })
  }
  return hits
}

describe('guest phones stay on the booking (BK-013)', () => {
  it('finds the message modules it is meant to police', () => {
    expect(files('src/lib/sms').length).toBeGreaterThan(10)
    expect(files('src/lib/email').length).toBeGreaterThan(10)
    expect(files('src/app/api/cron').length).toBeGreaterThan(20)
  })

  it('catches a guest phone being read', () => {
    expect(GUEST_PHONE.test('sendSMS(attendee.phone, body)')).toBe(true)
    expect(GUEST_PHONE.test('const to = booking.attendees[0].phone')).toBe(true)
    expect(GUEST_PHONE.test('guests?.[i]?.phone')).toBe(true)
    expect(GUEST_PHONE.test('const to = customer.mobile_number')).toBe(false)
  })

  it('no messaging, marketing, customer or cron module reads a guest phone', () => {
    expect(readersIn(MESSAGE_PATHS, GUEST_PHONE)).toEqual([])
  })

  it('no file passes a guest phone to ensureCustomerForPhone or sendSMS', () => {
    const pattern = /(ensureCustomerForPhone|sendSMS|sendSms)\s*\([^)]*\b(attendee|attendees|guest|guests)(\?\.)?(\[[^\]]*\])?(\?)?\.phone\b/
    expect(readersIn(['src'], pattern)).toEqual([])
  })
})
