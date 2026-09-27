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
 * The update refuses to raise any count of a rule the baseline already records.
 *
 * Adding a rule, or widening what one catches: give it a new id, or raise its `version`, then run
 * the update. The baseline records the version of every rule it was taken with (`$rules`), so the
 * update knows which rules are new or changed and may add their current counts; every other
 * rule still only goes down. The check fails until the update has recorded the new version, so a
 * rule can never sit unrecorded and be baselined later with fresh violations in it.
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

/**
 * Emails and PDFs, where `white` and `black` class names are not Tailwind colours, each with the
 * reason. The rest of raw-palette (bg-gray-100 and friends) still counts in these files.
 */
const EMAIL_AND_PDF: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /^src\/lib\/email\//,
    reason: 'Email HTML. Mail clients cannot read the stylesheet; colours come from src/lib/brand/palette.ts.',
  },
  {
    pattern: /^src\/lib\/pdf(?:\/|-generator\.ts$)/,
    reason: 'PDF rendering, outside the app stylesheet.',
  },
  {
    pattern: /^src\/lib\/[a-z-]+-template(?:-compact)?\.ts$/,
    reason:
      'Self-contained HTML print templates rendered to PDF. Their class names (border-black on the cash-up sheet) come from the template\'s own <style> block, not Tailwind, and black ink is the point on paper.',
  },
]

/**
 * The guest pages and the guest design system: the only files where the `anchor-*` and `guest-*`
 * tokens belong (UI_UX.md rule 7), each with the reason.
 */
const GUEST_FILES: Array<{ prefix: string; reason: string }> = [
  { prefix: 'src/components/features/guest/', reason: 'The guest design system: GuestShell and the Guest* components.' },
  { prefix: 'src/components/features/shared/Guest', reason: 'The guest buttons and cancel flow of the public manage-booking page.' },
  {
    prefix: 'src/components/features/feedback/StarRating.tsx',
    reason: 'Its default guest tone draws the stars on the public feedback page; tone="staff" (the feedback inbox) uses staff tokens.',
  },
  { prefix: 'src/app/g/', reason: 'Guest token pages (manage booking, pre-order, waitlist offers, feedback links).' },
  { prefix: 'src/app/booking-portal/', reason: 'The guest booking portal.' },
  { prefix: 'src/app/legacy-link/', reason: 'The retired short-link domain\'s guest notice.' },
  { prefix: 'src/app/privacy/', reason: 'The public privacy notice.' },
  { prefix: 'src/app/parking/', reason: 'The public guest parking pages. Staff parking is src/app/(authenticated)/parking.' },
  { prefix: 'src/app/recruitment/', reason: 'The public interview slot picker (/recruitment/book). Staff recruitment is under (authenticated).' },
  { prefix: 'src/app/(feedback)/', reason: 'The public feedback pages.' },
  { prefix: 'src/app/(dev)/guest-preview/', reason: 'The developer preview of the guest components.' },
  { prefix: 'src/app/not-found.tsx', reason: 'The site-wide 404, in the guest brand.' },
]

/** Where the raw brand ramp (brand-50 to brand-900) may be used: the app chrome, each with the reason. */
const BRAND_RAMP_FILES: Array<{ prefix: string; reason: string }> = [
  { prefix: 'src/ds/shell/', reason: 'The app shell: sidebar, topbar and the FOH clock band.' },
  { prefix: 'src/components/shells/', reason: 'The standalone page frames (sign-in, kiosk, staff standalone, Orange Jelly customer).' },
  { prefix: 'src/ds/composites/PageLayout.tsx', reason: 'Its dark kiosk header variant (headerVariant="dark") for the FOH manager iPad.' },
]

/**
 * Staff screens outside the design system, where `rounded-md` (10px here, not Tailwind's 6px)
 * was mostly meant as a card (`rounded-lg`) or a control (`rounded-default`).
 */
const STAFF_PREFIXES = [
  'src/app/(authenticated)/',
  'src/app/(staff-portal)/',
  'src/app/(timeclock)/',
  'src/app/(employee-onboarding)/',
  'src/app/(event-kiosk)/',
  'src/components/',
]
const isStaffFile = (file: string): boolean =>
  STAFF_PREFIXES.some((prefix) => file.startsWith(prefix)) && !GUEST_FILES.some((entry) => file.startsWith(entry.prefix))

const PALETTE = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const VARIANTS = '(?:[a-z0-9@\\[\\]=&>*_.-]+:)*'
const COLOUR_UTILITIES =
  'bg|text|border|border-[trblxy]|ring|ring-offset|divide|from|to|via|fill|stroke|outline|placeholder|accent|decoration|shadow'
/** Every utility that can take a guest or anchor token: colours, sizes, spacing, radii, type. */
const TOKEN_UTILITIES = [
  COLOUR_UTILITIES,
  'caret|rounded|rounded-[trblse]{1,2}|font|leading|tracking',
  'w|h|size|min-w|max-w|min-h|max-h',
  'p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y',
  'inset|inset-x|inset-y|top|right|bottom|left|scroll-m|scroll-p',
].join('|')

type Rule = {
  id: string
  /**
   * Raise when the rule starts catching more than before, so the next baseline update may add
   * the newly caught values. New rules start at 1.
   */
  version: number
  applies: (file: string) => boolean
  why: string
  /** Counted with a regex over the whole file (comments removed)... */
  pattern?: RegExp
  /** ...or with a custom counter. */
  count?: (text: string, file: string) => number
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
const RAW_PALETTE = new RegExp(
  `(?<![\\w-])${VARIANTS}(?:${COLOUR_UTILITIES})-(?:${PALETTE})-\\d{2,3}(?:\\/\\d+)?(?![\\w-])`,
  'g',
)
const RAW_WHITE_BLACK = new RegExp(`(?<![\\w-])${VARIANTS}(?:${COLOUR_UTILITIES})-(?:white|black)(?:\\/\\d+)?(?![\\w-])`, 'g')

const everywhere = () => true
const countOf = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length

const RULES: Rule[] = [
  {
    id: 'raw-palette',
    version: 2, // 2: white and black too (26 Sep 2026)
    applies: everywhere,
    why: 'Use a token (text-text-muted, border-border, bg-danger-soft, text-primary-fg, bg-overlay and so on) instead of a raw Tailwind colour, white or black.',
    count: (text, file) =>
      countOf(text, RAW_PALETTE) + (EMAIL_AND_PDF.some((entry) => entry.pattern.test(file)) ? 0 : countOf(text, RAW_WHITE_BLACK)),
  },
  {
    id: 'hex-colour',
    version: 1,
    applies: (file) => !ACCEPTED_HEX.some((entry) => entry.file === file),
    why: 'Hex belongs in src/app/globals.css or, for emails and PDFs, in src/lib/brand/palette.ts.',
    pattern: /(?<=['"`[(\s:,])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?=['"`\]),;\s])/g,
  },
  {
    id: 'bare-rounded',
    version: 1,
    applies: everywhere,
    why: 'Bare rounded is 4px, below the scale. Use rounded-sm (6px) or a DS component.',
    count: (text) => countBareWord(text, 'rounded'),
  },
  {
    id: 'off-scale-radius',
    version: 1,
    applies: everywhere,
    why: 'rounded-2xl (16px) is smaller than rounded-xl (20px) here. Use sm, default, md, lg, xl or pill.',
    pattern: new RegExp(`(?<![\\w-])${VARIANTS}rounded-(?:2xl|3xl)(?![\\w-])`, 'g'),
  },
  {
    id: 'off-scale-shadow',
    version: 1,
    applies: everywhere,
    why: 'Bare shadow, shadow-md and shadow-xl are untinted Tailwind defaults. Use shadow-xs, sm, default, lg or ring.',
    count: (text) => countBareWord(text, 'shadow') + countOf(text, NAMED_OFF_SCALE_SHADOW),
  },
  {
    id: 'dark-variant',
    version: 1,
    applies: everywhere,
    why: 'Dark mode was dropped on 18 Sep 2026.',
    pattern: /(?<![\w-])dark:(?=[a-z[])/g,
  },
  {
    id: 'px-text-size',
    version: 2, // 2: every pixel size, not only 0 to 16px (26 Sep 2026)
    applies: everywhere,
    why: 'Use the type scale: text-2xs (10), text-meta (11), text-xs (12), text-ui (13), text-sm (14), text-base (16) and up on staff screens; the text-guest-* sizes on guest pages.',
    pattern: /(?<![\w-])(?:[a-z0-9-]+:)*text-\[\d+(?:\.\d+)?px\]/g,
  },
  {
    id: 'legacy-hsl-var',
    version: 1,
    applies: everywhere,
    why: 'The shadcn HSL variables are gone. Use token utilities.',
    pattern: /hsl\(var\(--/g,
  },
  {
    id: 'raw-820-breakpoint',
    version: 1,
    applies: everywhere,
    why: 'Use max-shell: or shell:, which match the 820px mobile layer exactly.',
    pattern: /(?:max|min)-\[82[01]px\]:/g,
  },
  {
    id: 'sidebar-outside-shell',
    version: 1,
    applies: (file) => !file.startsWith('src/ds/shell/'),
    why: 'Sidebar tokens belong to the app shell. Buttons use Button variant="primary".',
    pattern: new RegExp(`(?<![\\w-])${VARIANTS}(?:bg|text|border|ring)-sidebar(?:\\/\\d+)?(?![\\w-])`, 'g'),
  },
  {
    id: 'legacy-focus-ring',
    version: 1,
    applies: everywhere,
    why: 'Focus is focus-visible:outline-hidden focus-visible:shadow-ring (shadow-ring-inset in clipping containers). outline-none hides focus in Windows high-contrast mode; use outline-hidden.',
    pattern: new RegExp(
      `(?<![\\w-])${VARIANTS}(?:(?:focus|focus-visible|focus-within):ring(?:-[\\w./[\\]-]+)?|ring-offset(?:-[\\w./[\\]-]+)?|outline-none)(?![\\w-])`,
      'g',
    ),
  },
  {
    id: 'guest-token-outside-guest',
    version: 1,
    applies: (file) => !GUEST_FILES.some((entry) => file.startsWith(entry.prefix)),
    why: 'The anchor-* and guest-* tokens are for guest pages inside GuestShell only (UI_UX rule 7). Staff screens use the staff tokens.',
    // anchor-* always has a suffix, so the SVG attribute text-anchor="end" never counts; guest
    // stands alone only as the container width (max-w-guest).
    pattern: new RegExp(
      `(?<![\\w-])${VARIANTS}(?:${TOKEN_UTILITIES})-(?:anchor-[a-z0-9-]+|guest(?:-[a-z0-9-]+)?)(?:\\/\\d+)?(?![\\w=:-])`,
      'g',
    ),
  },
  {
    id: 'brand-ramp-outside-shell',
    version: 1,
    applies: (file) => !BRAND_RAMP_FILES.some((entry) => file.startsWith(entry.prefix)),
    why: 'The brand ramp belongs to the app chrome. Use primary, primary-soft, primary-soft-fg or the on-dark tokens.',
    pattern: new RegExp(`(?<![\\w-])${VARIANTS}(?:${COLOUR_UTILITIES})-brand-\\d{2,3}(?:\\/\\d+)?(?![\\w-])`, 'g'),
  },
  {
    id: 'status-opacity',
    version: 1,
    applies: everywhere,
    why: 'Status fills and edges have their own tokens: bg-success-soft, border-warning-border, bg-primary-soft and so on, not an opacity of the base colour.',
    pattern: new RegExp(
      `(?<![\\w-])${VARIANTS}(?:bg|border|border-[trblxy])-(?:success|warning|danger|info|primary)\\/\\d+(?![\\w-])`,
      'g',
    ),
  },
  {
    id: 'rounded-md',
    version: 1,
    applies: isStaffFile,
    why: 'rounded-md is 10px here, not 6px. Cards and panels are rounded-lg (or DS Card), buttons, fields and clickable rows rounded-default, chips rounded-sm.',
    pattern: new RegExp(`(?<![\\w-])${VARIANTS}rounded(?:-[trblse]{1,2})?-md(?![\\w-])`, 'g'),
  },
]

type Counts = Record<string, Record<string, number>>
/** The rule versions a baseline was taken with, and the counts. */
type Baseline = { rules: Record<string, number>; counts: Counts }
const RULES_KEY = '$rules'

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

function countRule(rule: Rule, text: string, file: string): number {
  return rule.count ? rule.count(text, file) : countOf(text, rule.pattern!)
}

function countAll(): Counts {
  const counts: Counts = {}
  for (const full of sourceFiles(SRC)) {
    const file = relative(process.cwd(), full)
    if (file === 'src/app/globals.css') continue // the token source itself
    const text = stripComments(readFileSync(full, 'utf8'))
    for (const rule of RULES) {
      if (!rule.applies(file)) continue
      const n = countRule(rule, text, file)
      if (n > 0) (counts[file] ??= {})[rule.id] = n
    }
  }
  return counts
}

function readBaseline(): Baseline {
  try {
    const { [RULES_KEY]: rules, ...counts } = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Record<string, Record<string, number>>
    return { rules: rules ?? {}, counts }
  } catch {
    return { rules: {}, counts: {} }
  }
}

function writeBaseline(baseline: Baseline): void {
  const sortedRules = Object.fromEntries(Object.keys(baseline.rules).sort().map((id) => [id, baseline.rules[id]]))
  const sortedCounts = Object.fromEntries(Object.keys(baseline.counts).sort().map((file) => [file, baseline.counts[file]]))
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ [RULES_KEY]: sortedRules, ...sortedCounts }, null, 2)}\n`)
}

/**
 * What an update would write, and which counts it refuses to raise. A rule is re-baselined (its
 * counts may go up) only when the baseline has never recorded it or recorded an older version;
 * on a first run (no baseline at all) everything is taken as found. Every other count may only
 * fall, and a file that is clean for every rule drops out.
 */
function planBaselineUpdate(
  baseline: Baseline,
  actual: Counts,
  rules: ReadonlyArray<Pick<Rule, 'id' | 'version'>>,
): { raised: string[]; next: Baseline } {
  const firstRun = Object.keys(baseline.counts).length === 0 && Object.keys(baseline.rules).length === 0
  const rebaselined = new Set(
    rules.filter((rule) => firstRun || (baseline.rules[rule.id] ?? 0) < rule.version).map((rule) => rule.id),
  )
  const raised: string[] = []
  for (const [file, fileRules] of Object.entries(actual)) {
    for (const [ruleId, n] of Object.entries(fileRules)) {
      const allowed = baseline.counts[file]?.[ruleId] ?? 0
      if (!rebaselined.has(ruleId) && n > allowed) raised.push(`${file} ${ruleId}: ${allowed} -> ${n}`)
    }
  }
  return {
    raised,
    next: { rules: Object.fromEntries(rules.map((rule) => [rule.id, rule.version])), counts: actual },
  }
}

function describeRule(ruleId: string): string {
  return RULES.find((rule) => rule.id === ruleId)?.why ?? ''
}

describe('the baseline update', () => {
  const rules = [
    { id: 'old', version: 1 },
    { id: 'widened', version: 2 },
    { id: 'new', version: 1 },
  ]
  const baseline: Baseline = {
    rules: { old: 1, widened: 1 },
    counts: { 'a.tsx': { old: 2, widened: 1 }, 'b.tsx': { old: 1 } },
  }

  it('refuses to raise a rule the baseline already records at its current version', () => {
    const { raised } = planBaselineUpdate(baseline, { 'a.tsx': { old: 3 }, 'c.tsx': { old: 1 } }, rules)
    expect(raised).toEqual(['a.tsx old: 2 -> 3', 'c.tsx old: 0 -> 1'])
  })

  it('adds entries for a rule the baseline has never recorded', () => {
    const { raised, next } = planBaselineUpdate(baseline, { 'a.tsx': { old: 2, new: 4 }, 'c.tsx': { new: 1 } }, rules)
    expect(raised).toEqual([])
    expect(next.counts).toEqual({ 'a.tsx': { old: 2, new: 4 }, 'c.tsx': { new: 1 } })
    expect(next.rules).toEqual({ old: 1, widened: 2, new: 1 })
  })

  it('re-baselines a rule whose version went up, raising its counts', () => {
    const { raised, next } = planBaselineUpdate(baseline, { 'a.tsx': { old: 2, widened: 5 }, 'd.tsx': { widened: 2 } }, rules)
    expect(raised).toEqual([])
    expect(next.counts['a.tsx'].widened).toBe(5)
    expect(next.counts['d.tsx']).toEqual({ widened: 2 })
  })

  it('still refuses an old rule rising in the same run that adds a new one', () => {
    const { raised } = planBaselineUpdate(baseline, { 'a.tsx': { old: 3, new: 1, widened: 9 } }, rules)
    expect(raised).toEqual(['a.tsx old: 2 -> 3'])
  })

  it('lowers counts freely and drops files that are now clean', () => {
    const { raised, next } = planBaselineUpdate(baseline, { 'a.tsx': { old: 1 } }, rules)
    expect(raised).toEqual([])
    expect(next.counts).toEqual({ 'a.tsx': { old: 1 } })
  })

  it('treats a rule whose recorded version is newer than the code as recorded, not new', () => {
    const { raised } = planBaselineUpdate({ ...baseline, rules: { old: 3, widened: 2 } }, { 'b.tsx': { old: 2 } }, rules)
    expect(raised).toEqual(['b.tsx old: 1 -> 2'])
  })

  it('takes everything as found on a first run with no baseline', () => {
    const { raised, next } = planBaselineUpdate({ rules: {}, counts: {} }, { 'a.tsx': { old: 7 } }, rules)
    expect(raised).toEqual([])
    expect(next.counts).toEqual({ 'a.tsx': { old: 7 } })
  })
})

describe('the rules catch what they say', () => {
  const count = (id: string, text: string, file = 'src/app/(authenticated)/x/page.tsx'): number => {
    const rule = RULES.find((entry) => entry.id === id)!
    return rule.applies(file) ? countRule(rule, text, file) : 0
  }

  it('px-text-size: every pixel size, large or small', () => {
    expect(count('px-text-size', `'text-[13px] md:text-[22px] text-[40px] text-[12.5px]'`)).toBe(4)
    expect(count('px-text-size', `'text-[1.5rem] text-ui text-guest-h1'`)).toBe(0)
  })

  it('raw-palette: white and black too, but not in emails and PDFs', () => {
    expect(count('raw-palette', `'bg-white text-black/50 hover:border-white bg-gray-100'`)).toBe(4)
    expect(count('raw-palette', `'whitespace-nowrap text-primary-fg bg-overlay'`)).toBe(0)
    expect(count('raw-palette', `'border border-black bg-gray-100'`, 'src/lib/cashing-up-pdf-template.ts')).toBe(1)
    expect(count('raw-palette', `'text-white'`, 'src/lib/email/marketing/blocks/footer.ts')).toBe(0)
  })

  it('legacy-focus-ring: focus rings, ring offsets and outline-none', () => {
    expect(
      count('legacy-focus-ring', `'focus:ring-2 focus-visible:ring-primary focus:ring ring-offset-2 ring-offset-white outline-none'`),
    ).toBe(6)
    expect(count('legacy-focus-ring', `'focus-visible:outline-hidden focus-visible:shadow-ring ring-1 ring-border'`)).toBe(0)
  })

  it('guest-token-outside-guest: guest and anchor tokens on staff screens only', () => {
    const tokens = `'text-anchor-gold rounded-guest-field max-w-guest gap-guest-lg sm:text-guest-h1 bg-guest-bg/50'`
    expect(count('guest-token-outside-guest', tokens)).toBe(6)
    expect(count('guest-token-outside-guest', `'guest-theme guest-btn table-guests'`)).toBe(0)
    expect(count('guest-token-outside-guest', '`<text text-anchor="end" class="axis-label">`')).toBe(0)
    expect(count('guest-token-outside-guest', tokens, 'src/components/features/guest/GuestCard.tsx')).toBe(0)
    expect(count('guest-token-outside-guest', tokens, 'src/app/g/[token]/page.tsx')).toBe(0)
  })

  it('brand-ramp-outside-shell: the brand ramp outside the app chrome', () => {
    expect(count('brand-ramp-outside-shell', `'bg-brand-700 text-brand-50 border-t-brand-200/40'`)).toBe(3)
    expect(count('brand-ramp-outside-shell', `'bg-primary text-primary-soft-fg'`)).toBe(0)
    expect(count('brand-ramp-outside-shell', `'bg-brand-700'`, 'src/ds/composites/PageLayout.tsx')).toBe(0)
    expect(count('brand-ramp-outside-shell', `'bg-brand-700'`, 'src/components/shells/KioskShell.tsx')).toBe(0)
  })

  it('status-opacity: status colours as opacities', () => {
    expect(count('status-opacity', `'bg-warning/10 border-primary/20 hover:bg-danger/5 border-l-info/30'`)).toBe(4)
    expect(count('status-opacity', `'bg-warning-soft border-primary-border bg-cat-1/20 text-danger/80'`)).toBe(0)
  })

  it('rounded-md: on staff screens, not in the design system or on guest pages', () => {
    expect(count('rounded-md', `'rounded-md sm:rounded-t-md'`)).toBe(2)
    expect(count('rounded-md', `'rounded-md'`, 'src/components/features/employees/X.tsx')).toBe(1)
    expect(count('rounded-md', `'rounded-md'`, 'src/ds/primitives/Tooltip.tsx')).toBe(0)
    expect(count('rounded-md', `'rounded-md'`, 'src/components/features/guest/GuestCard.tsx')).toBe(0)
    expect(count('rounded-md', `'rounded-lg rounded-default rounded-sm'`)).toBe(0)
  })
})

describe('design tokens are used instead of raw values', () => {
  const actual = countAll()
  const baseline = readBaseline()

  if (process.env.UPDATE_DESIGN_TOKEN_BASELINE === '1') {
    it('writes a baseline that is never higher than before', () => {
      const { raised, next } = planBaselineUpdate(baseline, actual, RULES)
      expect(raised, 'The baseline can only go down. Fix these instead of raising it.').toEqual([])
      writeBaseline(next)
    })
    return
  }

  it('adds no new raw values', () => {
    const over: string[] = []
    for (const [file, rules] of Object.entries(actual)) {
      for (const [ruleId, n] of Object.entries(rules)) {
        const allowed = baseline.counts[file]?.[ruleId] ?? 0
        if (n > allowed) over.push(`${file}: ${ruleId} ${n} (allowed ${allowed}). ${describeRule(ruleId)}`)
      }
    }
    expect(over, 'New raw values were added. Use the design tokens in src/app/globals.css.').toEqual([])
  })

  it('has a baseline no looser than the code', () => {
    const loose: string[] = []
    for (const [file, rules] of Object.entries(baseline.counts)) {
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

  it('records every rule at its current version', () => {
    expect(
      baseline.rules,
      'A rule was added or widened. Record it: UPDATE_DESIGN_TOKEN_BASELINE=1 npx vitest run tests/guards/design-tokens.test.ts',
    ).toEqual(Object.fromEntries(RULES.map((rule) => [rule.id, rule.version])))
  })
})
