import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { maskPhone } from '@/lib/phone/mask'

/**
 * Guests' phone numbers stay out of the logs (BK-206, customer bookings review of 24 October 2026).
 *
 * Every failed or blocked text used to write the guest's full number into the production logs,
 * which anyone with access to them can read and which travel into any export. This reads every
 * logger and console call in the Twilio and SMS code and fails when one passes a phone field that
 * is not wrapped in maskPhone (src/lib/phone/mask.ts). Log the customer id alongside instead.
 */
const ROOT = process.cwd()

function smsSourceFiles(): string[] {
  const files = [join(ROOT, 'src/lib/twilio.ts')]
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        if (name !== '__tests__') walk(path)
      } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
        files.push(path)
      }
    }
  }
  walk(join(ROOT, 'src/lib/sms'))
  return files
}

const PHONE_KEYS = [
  'to', 'phone', 'phoneNumber', 'normalizedPhone', 'normalizedTo', 'mobile', 'mobile_number', 'mobile_e164',
  'from', 'fromNumber', 'toNumber', 'customerPhones', 'standardizedPhone', 'standardizedTo', 'contactPhone',
]
const LOG_CALL = /(logger\.(?:error|warn|info|debug)|console\.(?:warn|error|log|info))\(/g
// A property at the start of a line or after { or , : `to,`, `to }`, or `to: value`.
const PHONE_PROPERTY = new RegExp(`(?:^|[{,])\\s*(${PHONE_KEYS.join('|')})\\s*(:[^,}\\n]*)?(?=\\s*[,}\\n]|$)`, 'gm')

function unmaskedPhoneFields(): string[] {
  const found: string[] = []
  for (const file of smsSourceFiles()) {
    const text = readFileSync(file, 'utf8')
    for (const call of text.matchAll(LOG_CALL)) {
      let depth = 1
      let end = call.index! + call[0].length
      while (depth > 0 && end < text.length) {
        if (text[end] === '(') depth += 1
        else if (text[end] === ')') depth -= 1
        end += 1
      }
      const args = text.slice(call.index! + call[0].length, end - 1)
      for (const property of args.matchAll(PHONE_PROPERTY)) {
        const value = property[2] ?? ''
        if (/maskPhones?\(/.test(value)) continue
        const line = text.slice(0, call.index!).split('\n').length
        found.push(`${relative(ROOT, file)}:${line} ${property[1]}${value}`)
      }
    }
  }
  return found
}

describe('phone numbers in SMS logs', () => {
  it('masks every phone field the Twilio and SMS code logs', () => {
    expect(unmaskedPhoneFields(), 'Wrap the number in maskPhone() and log the customer id beside it').toEqual([])
  })

  it('keeps only the last three digits', () => {
    expect(maskPhone('+447123456789')).toBe('+*********789')
    expect(maskPhone('07123 456789')).toBe('********789')
    expect(maskPhone('12')).toBe('***')
    expect(maskPhone(null)).toBeNull()
  })
})
