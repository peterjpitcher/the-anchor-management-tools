import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Supabase returns at most 1,000 rows per request and gives no error when it cuts a
 * result short, so asking for more is not a bigger read: it is a silent truncation.
 * A read that needs every row pages with a stable unique order, through
 * `fetchAllRows` in `src/lib/supabase/paged-read.ts`, which throws rather than
 * returning a partial answer.
 *
 * This guard exists because the 16 September 2026 audit found eleven reads that had
 * been quietly wrong in production, several of them written as `.limit(5000)` by
 * authors who reasonably expected to get 5,000 rows.
 */
const SRC = join(process.cwd(), 'src')
const MAX_ROWS_PER_REQUEST = 1000

/**
 * Files allowed to ask for more than 1,000 rows, each with the reason it is safe.
 * Row counts are live figures from 15 September 2026. Adding to this list is a
 * decision about data volume, not a formality: if the table can reach 1,000 rows,
 * page the read instead.
 */
const ACCEPTED: Array<{ file: string; reason: string }> = [
  {
    file: 'src/app/api/cron/oj-projects-billing/route.ts',
    reason: 'OJ Projects tables are tiny: oj_entries 318 rows and about 290 a year, invoices 63, oj_recurring_charge_instances 46. The cap is around 2029.',
  },
  {
    file: 'src/lib/oj-projects/statement-cap.ts',
    reason: 'Same OJ Projects tables as the billing cron, scoped to one client.',
  },
  {
    file: 'src/app/actions/oj-projects/clients.ts',
    reason: 'invoice_vendors 11 rows, oj_projects 18, oj_vendor_billing_settings 5.',
  },
  {
    file: 'src/app/api/cron/oj-projects-retainer-projects/route.ts',
    reason: 'Reads the same handful of vendors and billing settings.',
  },
  {
    file: 'src/app/actions/oj-projects/invoice-reissue.ts',
    reason: 'One invoice worth of oj_entries and recurring charge instances.',
  },
  {
    file: 'src/app/actions/oj-projects/work-record.ts',
    reason: 'One client worth of oj_entries, a few dozen rows.',
  },
  {
    file: 'src/app/actions/oj-projects/entries.ts',
    reason: 'Chart data over oj_entries, which gains about 290 rows a year.',
  },
  {
    file: 'src/app/api/cron/event-guest-engagement/route.ts',
    reason: 'A 22-day booking window; bookings holds 1,538 rows in total and one event peaks at 398.',
  },
]

type Offence = { file: string; line: number; text: string }

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === '__mocks__') continue
      sourceFiles(full, found)
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      found.push(full)
    }
  }
  return found
}

function scan(match: (line: string) => number | null): Offence[] {
  const offences: Offence[] = []
  for (const file of sourceFiles(SRC)) {
    const rel = relative(process.cwd(), file)
    if (ACCEPTED.some((entry) => entry.file === rel)) continue
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      const rows = match(line)
      if (rows !== null && rows > MAX_ROWS_PER_REQUEST) {
        offences.push({ file: rel, line: index + 1, text: line.trim() })
      }
    })
  }
  return offences
}

describe('no query asks for more than 1,000 rows in one request', () => {
  it('has no .limit() above the server cap', () => {
    const offences = scan((line) => {
      const match = line.match(/\.limit\(\s*([0-9_]+)\s*\)/)
      return match ? Number(match[1].replace(/_/g, '')) : null
    })

    expect(
      offences,
      'These reads ask for more rows than the server will ever return, so they truncate silently. Page them with fetchAllRows from @/lib/supabase/paged-read, or add the file to ACCEPTED with the row counts that make it safe.',
    ).toEqual([])
  })

  it('has no .range() spanning more than 1,000 rows', () => {
    const offences = scan((line) => {
      const match = line.match(/\.range\(\s*([0-9_]+)\s*,\s*([0-9_]+)\s*\)/)
      if (!match) return null
      const from = Number(match[1].replace(/_/g, ''))
      const to = Number(match[2].replace(/_/g, ''))
      return to - from + 1
    })

    expect(
      offences,
      'A range wider than 1,000 rows returns only the first 1,000. Page it instead.',
    ).toEqual([])
  })

  it('keeps the accepted list honest', () => {
    for (const entry of ACCEPTED) {
      expect(() => statSync(join(process.cwd(), entry.file)), `${entry.file} no longer exists, so drop it from ACCEPTED`).not.toThrow()
      expect(entry.reason.length, `${entry.file} needs a reason`).toBeGreaterThan(20)
    }
  })
})
