import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * The 18 September 2026 audit found about 4,600 raw Tailwind colour classes, 1,100 hand-typed
 * sizes and 1,250 hand-typed hex values across the app, against a complete token set in
 * src/app/globals.css. Nothing stopped new ones being added, so every screen drifted. This
 * guard is a ratchet: each file may have at most its baseline count for each rule, and the
 * baseline may only go down.
 *
 * Fixed some? Lower the baseline and commit it with the fix:
 *   UPDATE_DESIGN_TOKEN_BASELINE=1 npx vitest run tests/guards/design-tokens.test.ts
 * The update refuses to raise any count.
 */
const SRC = join(process.cwd(), 'src')
const BASELINE_PATH = join(process.cwd(), 'tests/guards/design-tokens.baseline.json')

/**
 * Files where literal hex is permanently legitimate, each with the reason. Everything else
 * is ratcheted by the baseline rather than exempted.
 */
const ACCEPTED_HEX: Array<{ file: string; reason: string }> = [
  {
    file: 'src/lib/brand/palette.ts',
    reason: 'The one module for email and PDF colours, which cannot read CSS variables. A test pins every value to globals.css.',
  },
  {
    file: 'src/types/event-categories.ts',
    reason: 'Colours staff pick for event categories and store in the database: data, not styling.',
  },
  {
    file: 'src/lib/rota/shift-template-colours.ts',
    reason: 'Colours staff pick for shift templates and store in the database: data, not styling.',
  },
  {
    file: 'src/components/schedule-calendar/appearance.ts',
    reason: 'Calendar kinds share the user-pickable shift palette so kinds and notes look alike.',
  },
  {
    file: 'src/app/icon.tsx',
    reason: 'The favicon is rendered by next/og ImageResponse, outside the app stylesheet.',
  },
  {
    file: 'src/app/global-error.tsx',
    reason: 'Replaces the root layout, so the app stylesheet may not load; styled inline with the token values.',
  },
]

const PALETTE = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const VARIANTS = '(?:[a-z0-9@\\[\\]=&>*_.-]+:)*'
type Rule = {
  id: string
  applies: (file: string) => boolean
  why: string
  /** Counted with a regex over the whole file (comments removed)... */
  pattern?: RegExp
  /** ...or with a custom counter. */
  count?: (text: string) => number
}

/** Single-word utilities, so a class list made of them still reads as classes. */
const SINGLE_WORD_UTILITIES = new Set([
  'flex', 'grid', 'block', 'inline', 'hidden', 'contents', 'table', 'relative', 'absolute', 'fixed',
  'sticky', 'static', 'isolate', 'grow', 'shrink', 'truncate', 'italic', 'underline', 'uppercase',
  'lowercase', 'capitalize', 'visible', 'invisible', 'container', 'antialiased', 'rounded', 'shadow',
  'border', 'group', 'peer', 'transition', 'outline',
])
const STRING_LITERALS = /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g

/**
 * The strings in a file that read as class lists: at least two tokens, most of them shaped like
 * utilities, and at least one hyphenated or variant class. Prose ("rounded to the nearest
 * mile") and code (a variable called shadow) never qualify. Same rule as the codemod.
 */
function classListStrings(text: string): string[] {
  const lists: string[] = []
  for (const match of text.matchAll(STRING_LITERALS)) {
    const body = match[0].slice(1, -1)
    const tokens = body.trim().split(/\s+/).filter(Boolean)
    if (tokens.length < 2) continue
    const hyphenated = tokens.filter((token) => /[-:[]/.test(token)).length
    const classy = tokens.filter((token) => /[-:[]/.test(token) || SINGLE_WORD_UTILITIES.has(token)).length
    if (hyphenated > 0 && classy / tokens.length >= 0.6) lists.push(body)
  }
  return lists
}

/** How many times a bare utility word (rounded, shadow) appears as a class. */
function countBareWord(text: string, word: string): number {
  const re = new RegExp(`(?:^|\\s)${VARIANTS}${word}(?=\\s|$)`, 'g')
  return classListStrings(text).reduce((total, list) => total + (list.match(re) ?? []).length, 0)
}

const NAMED_OFF_SCALE_SHADOW = new RegExp(`(?<![\\w-])${VARIANTS}shadow-(?:md|xl|2xl)(?![\\w-])`, 'g')

const everywhere = () => true

const RULES: Rule[] = [
  {
    id: 'raw-palette',
    applies: everywhere,
    why: 'Use a token (text-text-muted, border-border, bg-danger-soft and so on) instead of a raw Tailwind colour.',
    pattern: new RegExp(
      `(?<![\\w-])${VARIANTS}(?:bg|text|border|border-[trblxy]|ring|ring-offset|divide|from|to|via|fill|stroke|outline|placeholder|accent|decoration|shadow)-(?:${PALETTE})-\\d{2,3}(?:\\/\\d+)?(?![\\w-])`,
      'g',
    ),
  },
  {
    id: 'hex-colour',
    applies: (file) => !ACCEPTED_HEX.some((entry) => entry.file === file),
    why: 'Hex belongs in src/app/globals.css or, for emails and PDFs, in src/lib/brand/palette.ts.',
    pattern: /(?<=['"`[(\s:,])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?=['"`\]),;\s])/g,
  },
  {
    id: 'bare-rounded',
    applies: everywhere,
    why: 'Bare rounded is 4px, below the scale. Use rounded-sm (6px) or a DS component.',
    count: (text) => countBareWord(text, 'rounded'),
  },
  {
    id: 'off-scale-radius',
    applies: everywhere,
    why: 'rounded-2xl (16px) is smaller than rounded-xl (20px) here. Use sm, default, md, lg, xl or pill.',
    pattern: new RegExp(`(?<![\\w-])${VARIANTS}rounded-(?:2xl|3xl)(?![\\w-])`, 'g'),
  },
  {
    id: 'off-scale-shadow',
    applies: everywhere,
    why: 'Bare shadow, shadow-md and shadow-xl are untinted Tailwind defaults. Use shadow-xs, sm, default, lg or ring.',
    count: (text) => countBareWord(text, 'shadow') + (text.match(NAMED_OFF_SCALE_SHADOW) ?? []).length,
  },
  {
    id: 'dark-variant',
    applies: everywhere,
    why: 'Dark mode was dropped on 18 Sep 2026.',
    pattern: /(?<![\w-])dark:(?=[a-z[])/g,
  },
  {
    id: 'px-text-size',
    applies: everywhere,
    why: 'Use text-2xs (10), text-meta (11), text-xs (12), text-ui (13), text-sm (14) or text-base (16).',
    pattern: /(?<![\w-])(?:[a-z0-9-]+:)*text-\[(?:[0-9]|1[0-6])(?:\.\d+)?px\]/g,
  },
  {
    id: 'legacy-hsl-var',
    applies: everywhere,
    why: 'The shadcn HSL variables are gone. Use token utilities.',
    pattern: /hsl\(var\(--/g,
  },
  {
    id: 'raw-820-breakpoint',
    applies: everywhere,
    why: 'Use max-shell: or shell:, which match the 820px mobile layer exactly.',
    pattern: /(?:max|min)-\[82[01]px\]:/g,
  },
  {
    id: 'sidebar-outside-shell',
    applies: (file) => !file.startsWith('src/ds/shell/'),
    why: 'Sidebar tokens belong to the app shell. Buttons use Button variant="primary".',
    pattern: new RegExp(`(?<![\\w-])${VARIANTS}(?:bg|text|border|ring)-sidebar(?:\\/\\d+)?(?![\\w-])`, 'g'),
  },
]

type Counts = Record<string, Record<string, number>>

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === '__mocks__') continue
      sourceFiles(full, found)
    } else if (/\.(tsx?|css)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      found.push(full)
    }
  }
  return found
}

/**
 * Comments are prose ("rounded to the nearest penny", "drop shadow"), not classes, so they
 * are removed before counting. The line-comment pattern skips `://` so URLs survive.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function countAll(): Counts {
  const counts: Counts = {}
  for (const full of sourceFiles(SRC)) {
    const file = relative(process.cwd(), full)
    if (file === 'src/app/globals.css') continue // the token source itself
    const text = stripComments(readFileSync(full, 'utf8'))
    for (const rule of RULES) {
      if (!rule.applies(file)) continue
      const n = rule.count ? rule.count(text) : (text.match(rule.pattern!) ?? []).length
      if (n > 0) (counts[file] ??= {})[rule.id] = n
    }
  }
  return counts
}

function readBaseline(): Counts {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Counts
  } catch {
    return {}
  }
}

function describeRule(ruleId: string): string {
  return RULES.find((rule) => rule.id === ruleId)?.why ?? ''
}

describe('design tokens are used instead of raw values', () => {
  const actual = countAll()
  const baseline = readBaseline()

  if (process.env.UPDATE_DESIGN_TOKEN_BASELINE === '1') {
    it('writes a baseline that is never higher than before', () => {
      const firstRun = Object.keys(baseline).length === 0
      const raised: string[] = []
      for (const [file, rules] of Object.entries(actual)) {
        for (const [ruleId, n] of Object.entries(rules)) {
          const allowed = baseline[file]?.[ruleId] ?? 0
          if (!firstRun && n > allowed) raised.push(`${file} ${ruleId}: ${allowed} -> ${n}`)
        }
      }
      expect(raised, 'The baseline can only go down. Fix these instead of raising it.').toEqual([])
      const sorted = Object.fromEntries(Object.keys(actual).sort().map((file) => [file, actual[file]]))
      writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`)
    })
    return
  }

  it('adds no new raw values', () => {
    const over: string[] = []
    for (const [file, rules] of Object.entries(actual)) {
      for (const [ruleId, n] of Object.entries(rules)) {
        const allowed = baseline[file]?.[ruleId] ?? 0
        if (n > allowed) over.push(`${file}: ${ruleId} ${n} (allowed ${allowed}). ${describeRule(ruleId)}`)
      }
    }
    expect(over, 'New raw values were added. Use the design tokens in src/app/globals.css.').toEqual([])
  })

  it('has a baseline no looser than the code', () => {
    const loose: string[] = []
    for (const [file, rules] of Object.entries(baseline)) {
      for (const [ruleId, allowed] of Object.entries(rules)) {
        const n = actual[file]?.[ruleId] ?? 0
        if (n < allowed) loose.push(`${file}: ${ruleId} baseline ${allowed}, now ${n}`)
      }
    }
    expect(
      loose,
      'Values were removed. Lower the baseline: UPDATE_DESIGN_TOKEN_BASELINE=1 npx vitest run tests/guards/design-tokens.test.ts',
    ).toEqual([])
  })
})
