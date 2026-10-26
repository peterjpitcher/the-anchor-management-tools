import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * These database functions run with full rights and have no permission check inside, so only
 * service_role may run them (migration 20261026181322, BK-105). A call through the staff
 * session client is refused with "permission denied for function", which would break the
 * event, invoice payment, customer import or private booking screen that made it.
 *
 * Each call must therefore go through createAdminClient(), after the calling action has
 * checked the user's permission.
 */

const ROOT = process.cwd()
const SERVER_ONLY_FUNCTIONS = [
  'create_event_transaction',
  'update_event_transaction',
  'record_invoice_payment_transaction',
  'import_customers_atomic',
  'create_private_booking_transaction',
]

function sourceFiles(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(join(ROOT, directory))) {
    const relative = `${directory}/${entry}`
    if (statSync(join(ROOT, relative)).isDirectory()) {
      found.push(...sourceFiles(relative))
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !entry.endsWith('.generated.ts')) {
      found.push(relative)
    }
  }
  return found
}

describe('server-only booking functions are called through the service-role client', () => {
  const files = sourceFiles('src').map((path) => ({ path, text: readFileSync(join(ROOT, path), 'utf8') }))

  for (const name of SERVER_ONLY_FUNCTIONS) {
    it(`calls ${name} only through createAdminClient()`, () => {
      const calls = files.filter(({ text }) => text.includes(name)).flatMap(({ path, text }) =>
        [...text.matchAll(new RegExp(`(\\S+)\\s*\\.rpc\\(\\s*['"]${name}['"]`, 'g'))].map((match) => ({
          path,
          receiver: match[1],
        })),
      )
      expect(calls.length).toBeGreaterThan(0)
      expect(calls.filter((call) => !call.receiver.endsWith('createAdminClient()'))).toEqual([])
    })
  }
})
