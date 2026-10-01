import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Every read of the payment and file tables says how many rows it can return.
 *
 * The server hands back at most 1,000 rows and says nothing when it stops there. The receipts
 * section had reads with no bound at all: the quarterly pack was built from one, so a busy
 * quarter would have gone to the accountant short, and the vendor headings totalled only the
 * rows on the page. `receipt_transactions` held 8,202 rows on 15 September 2026.
 *
 * A read is bounded when its chain pages (`.range`), caps (`.limit`), asks for one row
 * (`.single`, `.maybeSingle`), only counts (`head: true`), or names its rows (`.eq('id', …)`,
 * `.in(…)` over a list the caller keeps short). Anything else is listed here with the reason
 * it cannot outgrow one request.
 */
const SRC = join(process.cwd(), 'src')
const TABLES = ['receipt_transactions', 'receipt_files']

const BOUNDS = [
  /\.range\(/,
  /\.limit\(/,
  /\.single\(\)/,
  /\.maybeSingle\(\)/,
  /head:\s*true/,
  /\.eq\(\s*'id'/,
  // A list of ids the caller cut to size. `.in('status', …)` names no rows, so it is no bound.
  /\.in\(\s*'id'/,
]

/** Reads allowed with no bound in the chain, each with why it is safe. */
const ACCEPTED: Array<{ file: string; contains: string; reason: string }> = [
  {
    file: 'src/services/receipts/receiptInvoiceReconciliation.ts',
    contains: ".ilike('details', '%INV-%')",
    reason: 'Paged by fetchAllRows: the .range is added in the next statement, after the optional id filter.',
  },
  {
    file: 'src/services/receipts/receiptInvoiceReconciliation.ts',
    contains: ".not('details', 'ilike', '%INV-%')",
    reason: 'Paged by fetchAllRows: the .range is added in the next statement, after the optional id filter.',
  },
  {
    file: 'src/services/receipts/receiptQueries.ts',
    contains: "receipt_rules!receipt_transactions_rule_applied_id_fkey(id,name)', { count: 'exact' }",
    reason: 'The workspace page: .range(offset, offset + pageSize - 1) is applied after the sort keys, and the page size is capped at 100.',
  },
]

type Read = { file: string; line: number; text: string }

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

/**
 * The chain that starts at `.from('<table>')`: up to the next blank line, the next `.from(` or
 * forty lines, whichever comes first. A chain is one statement, and the code leaves a blank
 * line between statements.
 */
function chainFrom(lines: string[], start: number): string {
  const chain = [lines[start]]
  for (let index = start + 1; index < Math.min(lines.length, start + 40); index += 1) {
    const line = lines[index]
    if (line.trim() === '' || /\.from\(/.test(line)) break
    chain.push(line)
  }
  return chain.join('\n')
}

function unboundedReads(): Read[] {
  const offences: Read[] = []
  for (const file of sourceFiles(SRC)) {
    const rel = relative(process.cwd(), file)
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, index) => {
      if (!TABLES.some((table) => line.includes(`.from('${table}')`))) return
      const chain = chainFrom(lines, index)
      // Writes are not reads. A write that returns its rows names them by id or by a filter.
      if (/\.(update|insert|upsert|delete)\(/.test(chain)) return
      if (!/\.select\(/.test(chain)) return
      if (BOUNDS.some((bound) => bound.test(chain))) return
      if (ACCEPTED.some((entry) => entry.file === rel && chain.includes(entry.contains))) return
      offences.push({ file: rel, line: index + 1, text: line.trim() })
    })
  }
  return offences
}

describe('reads of the receipts payment and file tables are bounded', () => {
  it('has no read that could be cut short at 1,000 rows without saying so', () => {
    expect(
      unboundedReads(),
      'These reads have no bound, so they stop at 1,000 rows and say nothing. Page them with fetchAllRows from @/lib/supabase/paged-read, give them a .limit, or add them to ACCEPTED with the reason they cannot outgrow one request.'
    ).toEqual([])
  })

  it('finds the reads it is meant to judge', () => {
    // If the code stops writing `.from('receipt_transactions')` in this form, the guard above
    // would pass by looking at nothing.
    let seen = 0
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (const table of TABLES) seen += text.split(`.from('${table}')`).length - 1
    }
    expect(seen).toBeGreaterThan(20)
  })

  it('keeps the accepted list honest', () => {
    for (const entry of ACCEPTED) {
      const text = readFileSync(join(process.cwd(), entry.file), 'utf8')
      expect(text.includes(entry.contains), `${entry.file} no longer contains the accepted read, so drop it from ACCEPTED`).toBe(true)
      expect(entry.reason.length).toBeGreaterThan(20)
    }
  })
})
