import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * A voided cash-up stays on record but is out of every takings total (BK-219).
 *
 * The P&L, the dashboard takings and the rota sales-against-target all summed
 * cashup_sessions.total_counted_amount without leaving voided sessions out. Nothing had been
 * voided yet, so no figure was wrong, but the first void would have counted twice once the
 * day was cashed up again. This guard finds every query chain that starts at
 * `.from('cashup_sessions')` and reads `total_counted_amount`, and fails unless the same chain
 * filters on `voided_at`.
 */
const ROOT = process.cwd()

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

/** The text of each `.from('cashup_sessions')` chain, up to the next `.from(` or a blank line. */
function cashupChains(text: string): Array<{ line: number; chain: string }> {
  const chains: Array<{ line: number; chain: string }> = []
  const re = /\.from\(\s*'cashup_sessions'\s*\)/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const rest = text.slice(m.index + m[0].length)
    const stop = rest.search(/\.from\(|\n\s*\n/)
    chains.push({
      line: text.slice(0, m.index).split('\n').length,
      chain: stop === -1 ? rest : rest.slice(0, stop),
    })
  }
  return chains
}

describe('takings totals leave voided cash-ups out', () => {
  it('filters voided_at wherever total_counted_amount is read from cashup_sessions', () => {
    const offenders: string[] = []
    let checked = 0
    for (const file of sourceFiles(join(ROOT, 'src'))) {
      const text = readFileSync(file, 'utf8')
      if (!text.includes("'cashup_sessions'")) continue
      for (const { line, chain } of cashupChains(text)) {
        if (!chain.includes('total_counted_amount')) continue
        checked++
        if (!chain.includes('voided_at')) offenders.push(`${relative(ROOT, file)}:${line}`)
      }
    }
    expect(checked).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
})
