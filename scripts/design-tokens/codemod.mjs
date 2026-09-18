#!/usr/bin/env node
/**
 * Design-token codemod (plan: tasks/plan-2026-09-18-design-tokens.md, PR-07 and PR-08).
 *
 * Swaps raw Tailwind classes for design tokens inside string literals only (JSX attribute
 * strings, cn() arguments, class maps, template literal text). Identifiers and comments are
 * never touched, so a variable called `rounded` or a comment about a "drop shadow" is safe.
 * Variant prefixes (hover:, md:, focus:, group-hover: ...) and opacity suffixes (/50) are kept.
 *
 * Dry run by default. Usage:
 *   node scripts/design-tokens/codemod.mjs --step=a            # report what would change
 *   node scripts/design-tokens/codemod.mjs --step=a --write    # apply
 *   node scripts/design-tokens/codemod.mjs --step=b --write    # secondary greys (owner decision D3)
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const args = new Set(process.argv.slice(2))
const WRITE = args.has('--write')
const STEP = [...args].find((arg) => arg.startsWith('--step='))?.slice('--step='.length) ?? 'a'

/** Folders the codemod walks. */
const INCLUDE_DIRS = ['src/app', 'src/components', 'src/ds', 'tests']
/** Single files outside those folders that hold UI class maps. */
const INCLUDE_FILES = ['src/lib/table-bookings/ui.ts']
/**
 * Never touched: guest pages use the guest token namespace; the style guide prints class
 * names as documentation; API routes render HTML outside the app stylesheet; the guard's own
 * test holds rule text.
 */
const EXCLUDE_PREFIXES = [
  'src/components/features/guest/',
  'src/app/g/',
  'src/app/booking-portal/',
  'src/app/parking/',
  'src/app/invoice-portal/',
  'src/app/privacy/',
  'src/app/(feedback)/',
  'src/app/legacy-link/',
  'src/app/(authenticated)/settings/design-system/',
  'src/app/api/',
  'tests/guards/',
  // Tests for the guest pages above assert the guest pages' own classes.
  'tests/components/guest-routes/',
  'tests/components/guest/',
]

/** Exact whole-class swaps, including any variant written here. Checked before BASE_A. */
const EXACT_A = new Map([
  ['placeholder:text-gray-400', 'placeholder:text-text-subtle'],
  ['hover:bg-gray-50', 'hover:bg-surface-hover'],
  ['focus:border-green-500', 'focus:border-border-focus'],
  ['focus:border-blue-500', 'focus:border-border-focus'],
  ['disabled:opacity-30', 'disabled:opacity-50'],
  ['disabled:opacity-40', 'disabled:opacity-50'],
  ['disabled:opacity-60', 'disabled:opacity-50'],
  ['disabled:opacity-70', 'disabled:opacity-50'],
])

/** Base-class swaps; any variant prefix on the class is preserved. */
const BASE_A = new Map([
  ['text-gray-900', 'text-text'],
  ['text-gray-800', 'text-text'],
  ['text-gray-950', 'text-text-strong'],
  ['text-gray-600', 'text-text-muted'],
  ['text-gray-300', 'text-text-subtle'],
  ['border-gray-200', 'border-border'],
  ['border-gray-100', 'border-border'],
  ['border-gray-300', 'border-border-strong'],
  ['divide-gray-200', 'divide-border'],
  ['divide-gray-100', 'divide-border'],
  ['divide-gray-50', 'divide-border'],
  ['bg-white', 'bg-surface'],
  ['bg-gray-50', 'bg-surface-2'],
  ['bg-gray-100', 'bg-surface-hover'],
  ['bg-gray-200', 'bg-border'],
  ['text-red-600', 'text-danger'],
  ['text-red-500', 'text-danger'],
  ['text-red-800', 'text-danger-fg'],
  ['text-red-900', 'text-danger-fg'],
  ['bg-red-50', 'bg-danger-soft'],
  ['bg-red-100', 'bg-danger-soft'],
  ['bg-green-50', 'bg-success-soft'],
  ['bg-green-100', 'bg-success-soft'],
  ['bg-amber-50', 'bg-warning-soft'],
  ['bg-yellow-50', 'bg-warning-soft'],
  ['text-amber-600', 'text-warning'],
  ['text-yellow-600', 'text-warning'],
  ['text-amber-700', 'text-warning-fg'],
  ['text-amber-800', 'text-warning-fg'],
  ['text-amber-900', 'text-warning-fg'],
  ['text-amber-950', 'text-warning-fg'],
  ['text-yellow-700', 'text-warning-fg'],
  ['text-yellow-800', 'text-warning-fg'],
  ['text-blue-800', 'text-info-fg'],
  ['text-blue-900', 'text-info-fg'],
  ['rounded-2xl', 'rounded-xl'],
  ['rounded-3xl', 'rounded-xl'],
  ['rounded-[6px]', 'rounded-sm'],
  ['rounded-[8px]', 'rounded-default'],
  ['rounded-[10px]', 'rounded-md'],
  ['rounded-[9999px]', 'rounded-pill'],
  ['shadow-md', 'shadow-default'],
  ['shadow-xl', 'shadow-lg'],
  ['shadow-2xl', 'shadow-lg'],
  ['text-[7px]', 'text-2xs'],
  ['text-[8px]', 'text-2xs'],
  ['text-[9px]', 'text-2xs'],
  ['text-[9.5px]', 'text-2xs'],
  ['text-[10px]', 'text-2xs'],
  ['text-[10.5px]', 'text-2xs'],
  ['text-[11px]', 'text-meta'],
  ['text-[12px]', 'text-xs'],
  ['text-[13px]', 'text-ui'],
  ['text-[14px]', 'text-sm'],
  ['text-[16px]', 'text-base'],
  ['min-h-[44px]', 'min-h-touch'],
  ['min-w-[44px]', 'min-w-touch'],
  ['min-h-[48px]', 'min-h-12'],
  ['min-h-[56px]', 'min-h-14'],
  // Bare words: only ever matched as a whole class inside a string (see swapClass).
  ['rounded', 'rounded-sm'],
  ['shadow', 'shadow-sm'],
])

const BASE_B = new Map([
  ['text-gray-500', 'text-text-muted'],
  ['text-gray-700', 'text-text'],
])

const SPACING_TOKENS = new Set([
  'cell-y', 'input-h', 'btn-h', 'btn-h-sm', 'btn-h-lg', 'sidebar-expanded', 'sidebar-collapsed',
  'topbar', 'logo-row', 'pad-card', 'page-shell-pad-y', 'touch', 'shell-pad-top', 'shell-pad-x',
  'shell-pad-bottom',
])

const RADIUS_TOKENS = new Set(['sm', 'default', 'md', 'lg', 'xl', 'pill'])

/**
 * Swap one whitespace-delimited class. Returns [newClass, mappingKey] or null. A class that
 * becomes '' is deleted by the caller (dark: variants, owner decision D7).
 */
function swapClass(cls) {
  if (STEP === 'a') {
    if (/(^|:)dark:/.test(cls) || cls.startsWith('dark:')) return ['', 'dark:*']
    if (EXACT_A.has(cls)) return [EXACT_A.get(cls), cls]
  }
  const match = cls.match(/^((?:[a-z0-9@[\]=&>*_.-]+:)*)(!?)(.+?)((?:\/\d+)?)$/)
  if (!match) return null
  const [, variants, bang, base, alpha] = match
  const table = STEP === 'a' ? BASE_A : BASE_B
  if (table.has(base)) return [`${variants}${bang}${table.get(base)}${alpha}`, base]
  if (STEP === 'a') {
    const spacing = base.match(/^(-?[a-z-]+)-\[var\(--spacing-([a-z0-9-]+)\)\]$/)
    if (spacing && SPACING_TOKENS.has(spacing[2])) {
      return [`${variants}${bang}${spacing[1]}-${spacing[2]}${alpha}`, 'spacing var()']
    }
    const radius = base.match(/^(rounded(?:-[trblse]{1,2})?)-\[var\(--radius-([a-z]+)\)\]$/)
    if (radius && RADIUS_TOKENS.has(radius[2])) {
      return [`${variants}${bang}${radius[1]}-${radius[2]}${alpha}`, 'radius var()']
    }
  }
  return null
}

/** Utilities that are a single word, so a class list made of them still reads as classes. */
const SINGLE_WORD_UTILITIES = new Set([
  'flex', 'grid', 'block', 'inline', 'hidden', 'contents', 'table', 'relative', 'absolute', 'fixed',
  'sticky', 'static', 'isolate', 'grow', 'shrink', 'truncate', 'italic', 'underline', 'uppercase',
  'lowercase', 'capitalize', 'visible', 'invisible', 'container', 'antialiased', 'rounded', 'shadow',
  'border', 'group', 'peer', 'transition', 'outline',
])
const BARE_WORDS = new Set(['rounded', 'shadow'])
const looksLikeClass = (token) => /[-:[]/.test(token) || SINGLE_WORD_UTILITIES.has(token)

/**
 * Only strings that read as class lists are rewritten: most tokens must look like utilities,
 * so UI copy such as "Don't add a shadow here" is left alone. Bare words (rounded, shadow) are
 * swapped only beside at least one hyphenated class, so a lone prop value like
 * variant="shadow" is never changed.
 */
function rewriteString(text, counts) {
  if (!/[a-z]/.test(text)) return text
  const tokens = text.trim().split(/\s+/)
  if (tokens.filter(looksLikeClass).length / tokens.length < 0.6) return text
  const hasHyphenatedClass = tokens.some((token) => /[-:[]/.test(token))
  const parts = text.split(/(\s+)/)
  let changed = false
  const out = []
  for (const part of parts) {
    if (part === '' || /^\s+$/.test(part)) { out.push(part); continue }
    if (BARE_WORDS.has(part) && (tokens.length < 2 || !hasHyphenatedClass)) { out.push(part); continue }
    const swapped = swapClass(part)
    if (!swapped) { out.push(part); continue }
    counts[swapped[1]] = (counts[swapped[1]] ?? 0) + 1
    changed = true
    out.push(swapped[0])
  }
  if (!changed) return text
  // Remove the gaps a deleted class leaves behind, without touching the string's own edges.
  const joined = out.join('')
  const lead = joined.match(/^\s*/)[0]
  const trail = joined.match(/\s*$/)[0]
  const middle = joined.slice(lead.length, joined.length - trail.length).replace(/\s{2,}/g, ' ')
  return lead + middle + trail
}

/**
 * Walk a TS/TSX source, rewriting only the text of string literals and template literal
 * chunks. Comments and code are copied untouched. Regex literals are rare in UI files; a
 * quote inside one would only make the lexer treat code as a string, which the class-only
 * matching then leaves alone.
 */
function transform(source, counts) {
  let out = ''
  let i = 0
  const n = source.length
  const braceStack = []
  while (i < n) {
    const ch = source[i]
    const next = source[i + 1]
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i)
      const stop = end === -1 ? n : end
      out += source.slice(i, stop)
      i = stop
      continue
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      out += source.slice(i, stop)
      i = stop
      continue
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1
      while (j < n && source[j] !== ch && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1
      out += ch + rewriteString(source.slice(i + 1, j), counts) + (source[j] ?? '')
      i = j + 1
      continue
    }
    if (ch === '`' || (ch === '}' && braceStack.length && braceStack[braceStack.length - 1] === 'tpl')) {
      if (ch === '}') braceStack.pop()
      let j = i + 1
      let chunk = ''
      while (j < n && source[j] !== '`' && !(source[j] === '$' && source[j + 1] === '{')) {
        if (source[j] === '\\') { chunk += source.slice(j, j + 2); j += 2; continue }
        chunk += source[j]
        j += 1
      }
      out += ch + rewriteString(chunk, counts)
      if (source[j] === '$') {
        out += '${'
        braceStack.push('tpl')
        i = j + 2
      } else {
        out += source[j] ?? ''
        i = j + 1
      }
      continue
    }
    if (ch === '{') braceStack.push('code')
    else if (ch === '}' && braceStack.length) braceStack.pop()
    out += ch
    i += 1
  }
  return out
}

function walk(dir, found = []) {
  if (!existsSync(dir)) return found
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, found)
    else if (/\.(tsx?|jsx?)$/.test(entry)) found.push(full)
  }
  return found
}

const files = [
  ...INCLUDE_DIRS.flatMap((dir) => walk(join(ROOT, dir))),
  ...INCLUDE_FILES.map((file) => join(ROOT, file)).filter((file) => existsSync(file)),
]
  .map((full) => relative(ROOT, full))
  .filter((file) => !EXCLUDE_PREFIXES.some((prefix) => file.startsWith(prefix)))

const totals = {}
let filesChanged = 0
for (const file of files) {
  const source = readFileSync(join(ROOT, file), 'utf8')
  const counts = {}
  const result = transform(source, counts)
  if (result === source) continue
  filesChanged += 1
  for (const [key, count] of Object.entries(counts)) totals[key] = (totals[key] ?? 0) + count
  const summary = Object.entries(counts).map(([key, count]) => `${key} x${count}`).join(', ')
  console.log(`${WRITE ? 'changed' : 'would change'} ${file}: ${summary}`)
  if (WRITE) writeFileSync(join(ROOT, file), result)
}

console.log(`\nstep ${STEP}: ${filesChanged} files ${WRITE ? 'changed' : 'would change'}`)
for (const [key, count] of Object.entries(totals).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(5)}  ${key}`)
}
if (!WRITE) console.log('\nDry run. Add --write to apply.')
