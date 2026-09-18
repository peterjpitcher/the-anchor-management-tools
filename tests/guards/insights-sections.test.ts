import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { INSIGHT_SECTIONS } from '@/lib/insights/registry'
import { SECTION_KEYS } from '@/lib/insights/types'

/**
 * Insights sections read through `ctx.db`, a per-section client whose every request carries
 * the section's abort signal, and describe one fixed instant (`ctx.now`). A section that
 * builds its own client escapes the deadline; one that calls new Date() or reads "today"
 * itself can disagree with the rest of the report; one that writes is not a report.
 */
const SECTIONS_DIR = join(process.cwd(), 'src/lib/insights/sections')
const LONG_DASH = new RegExp(String.fromCharCode(0x2014))

const FORBIDDEN: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /from ['"]@\/lib\/supabase\/(admin|server|client)['"]/, reason: 'sections must use ctx.db, not their own client' },
  { pattern: /from ['"]@supabase\//, reason: 'sections must use ctx.db, not their own client' },
  { pattern: /\.(insert|update|upsert|delete)\s*\(/, reason: 'sections are read only' },
  { pattern: /new Date\(\s*\)/, reason: 'use ctx.now, the single instant of the report' },
  { pattern: /Date\.now\(\s*\)/, reason: 'use ctx.now, the single instant of the report' },
  { pattern: /getTodayIsoDate\(|getLocalIsoDateDays(Ago|Ahead)\(/, reason: 'use ctx.windows, derived from ctx.now' },
  { pattern: /Section not implemented/, reason: 'every section must be built' },
  { pattern: LONG_DASH, reason: 'no long dashes in report text' },
]

describe('insights section guard', () => {
  const files = readdirSync(SECTIONS_DIR).filter((file) => file.endsWith('.ts'))

  it('has one section file per report section', () => {
    expect(files).toHaveLength(SECTION_KEYS.length)
  })

  it('registers every section exactly once, in report order', () => {
    expect(INSIGHT_SECTIONS.map((definition) => definition.key)).toEqual([...SECTION_KEYS])
  })

  for (const file of files) {
    it(`${file} only reads through ctx.db at ctx.now`, () => {
      const source = readFileSync(join(SECTIONS_DIR, file), 'utf8')
      const offences = FORBIDDEN.filter(({ pattern }) => pattern.test(source)).map(({ reason }) => reason)
      expect(offences).toEqual([])
    })
  }
})
