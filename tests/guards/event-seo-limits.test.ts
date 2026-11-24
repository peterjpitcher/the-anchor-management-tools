import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * One rule set for event page copy (tasks/spec-2026-11-24-event-seo-generation.md, 6.1.7).
 * Before November 2026 the prompt, the gate, the health score and the drawer each carried their
 * own numbers for the same field, five different meta title limits among them. Every number now
 * comes from src/lib/event-seo/limits.ts; this fails if one of those files grows its own again.
 */
const FILES = [
  'src/lib/event-seo/prompts.ts',
  'src/lib/seo-validation.ts',
  'src/lib/event-seo/health.ts',
  'src/components/features/events/SeoHealthIndicator.tsx',
  'src/app/(authenticated)/events/_components/EventDrawer.tsx',
]

const ROOT = join(__dirname, '..', '..')

// "20-40 characters", "120 to 155 chars", "320-420 words", "3-5 paragraphs"
const LITERAL_RANGE = /\b\d{1,3}\s*(?:-|to|–)\s*\d{1,3}\s*(?:characters|chars|words|paragraphs|highlights|FAQs?)\b/i
// "length > 60", "metaTitle.length <= 40", "countWords(x) < 200"
const LITERAL_COMPARISON = /(?:\.length|countWords\([^)]*\)|wordCount|paras\.length)\s*[<>]=?\s*\d{2,}/
// "(12/60)" style drawer counters
const LITERAL_COUNTER = /\.length\}\/\d{2,}/

describe('event SEO limits live in one module', () => {
  it.each(FILES)('%s carries no copy limit of its own', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8')
    const offending = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      // Not event page copy: the cancellation policy has its own field limit.
      .filter((line) => !line.includes('cancellationPolicy'))
      .filter((line) => LITERAL_RANGE.test(line) || LITERAL_COMPARISON.test(line) || LITERAL_COUNTER.test(line))
    expect(offending).toEqual([])
  })

  it.each(FILES.slice(0, 4))('%s imports the limits module', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8')
    expect(/event-seo\/limits|from '\.\/limits'|from '@\/lib\/event-seo\/health'/.test(source)).toBe(true)
  })
})
