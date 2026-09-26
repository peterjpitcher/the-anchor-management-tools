import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cn } from '@/lib/utils'

/** The custom token names of one namespace in the @theme static block of globals.css. */
function themeTokens(namespace: string): string[] {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
  const start = css.indexOf('@theme static {')
  const block = css.slice(start, css.indexOf('\n}\n', start))
  // `--text-guest-h1--line-height` and friends are sub-properties, not utilities: the name
  // pattern stops at a double hyphen, so they never match.
  const re = new RegExp(`^\\s*--${namespace}-([a-z0-9]+(?:-[a-z0-9]+)*):`, 'gm')
  return [...block.matchAll(re)].map((match) => match[1])
}

describe('cn knows the design tokens', () => {
  it('lets a later arbitrary shadow override shadow-ring (DS error halo)', () => {
    expect(cn('focus:shadow-ring', 'focus:shadow-[0_0_0_3px_red]')).toBe('focus:shadow-[0_0_0_3px_red]')
  })

  it('treats custom radii as radii', () => {
    expect(cn('rounded-md', 'rounded-pill')).toBe('rounded-pill')
    expect(cn('rounded-pill', 'rounded-md')).toBe('rounded-md')
    expect(cn('rounded-lg', 'rounded-default')).toBe('rounded-default')
  })

  it('treats custom shadows as shadows, not colours', () => {
    expect(cn('shadow-sm', 'shadow-default')).toBe('shadow-default')
    expect(cn('shadow-default', 'shadow-black/10')).toBe('shadow-default shadow-black/10')
    expect(cn('focus-visible:shadow-ring', 'focus-visible:shadow-ring-inset')).toBe('focus-visible:shadow-ring-inset')
  })

  it('treats custom spacing as spacing', () => {
    expect(cn('h-btn-h', 'h-9')).toBe('h-9')
    expect(cn('p-pad-card', 'p-4')).toBe('p-4')
    expect(cn('min-h-touch', 'min-h-10')).toBe('min-h-10')
  })

  it('treats custom text sizes as font sizes, not colours', () => {
    expect(cn('text-sm', 'text-ui')).toBe('text-ui')
    expect(cn('text-ui', 'text-danger')).toBe('text-ui text-danger')
    expect(cn('text-meta', 'text-text-muted')).toBe('text-meta text-text-muted')
    expect(cn('text-2xs', 'text-xs')).toBe('text-xs')
  })

  it('still merges colour tokens', () => {
    expect(cn('text-text-muted', 'text-danger')).toBe('text-danger')
    expect(cn('bg-surface', 'bg-primary')).toBe('bg-primary')
    expect(cn('border-border', 'border-danger-border')).toBe('border-danger-border')
    // Colour tokens need no registration in cn(): tailwind-merge takes any colour name.
    expect(cn('border-primary/20', 'border-primary-border')).toBe('border-primary-border')
    expect(cn('border', 'border-primary-border')).toBe('border border-primary-border')
  })
})

describe('cn knows the guest tokens', () => {
  it('keeps a guest type size beside a guest colour', () => {
    expect(cn('text-guest-h1', 'text-anchor-gold')).toBe('text-guest-h1 text-anchor-gold')
    expect(cn('text-anchor-green', 'text-guest-body')).toBe('text-anchor-green text-guest-body')
    expect(cn('text-guest-small', 'text-guest-text-muted')).toBe('text-guest-small text-guest-text-muted')
  })

  it('lets a later guest type size replace an earlier size', () => {
    expect(cn('text-guest-body', 'text-guest-lead')).toBe('text-guest-lead')
    expect(cn('text-sm', 'text-guest-amount-wide')).toBe('text-guest-amount-wide')
    expect(cn('text-guest-h1', 'text-guest-h1-wide')).toBe('text-guest-h1-wide')
  })

  it('treats guest spacing, line height, tracking and widths as their own groups', () => {
    expect(cn('gap-guest-lg', 'gap-4')).toBe('gap-4')
    expect(cn('px-4', 'px-guest-md')).toBe('px-guest-md')
    expect(cn('min-h-guest-touch', 'min-h-guest-control')).toBe('min-h-guest-control')
    expect(cn('leading-6', 'leading-guest-body')).toBe('leading-guest-body')
    expect(cn('tracking-wide', 'tracking-guest-label')).toBe('tracking-guest-label')
    expect(cn('max-w-guest', 'max-w-guest-wide')).toBe('max-w-guest-wide')
  })

  it('treats the guest font families as families, not weights', () => {
    expect(cn('font-anchor-body', 'font-anchor-display')).toBe('font-anchor-display')
    expect(cn('font-anchor-display', 'font-semibold')).toBe('font-anchor-display font-semibold')
  })
})

/**
 * Every custom token in globals.css merges as its own kind. A token namespace tailwind-merge does
 * not know reads as a colour (text sizes) or as nothing at all (spacing, line height), so a
 * conflicting class survives or, worse, a real one is dropped. Add the name to src/lib/utils.ts.
 */
describe('cn registers every custom token in globals.css', () => {
  const checks: Array<{ namespace: string; check: (name: string) => void }> = [
    {
      namespace: 'text',
      check: (name) => {
        expect(cn('text-sm', `text-${name}`), `text-${name} is a size`).toBe(`text-${name}`)
        expect(cn(`text-${name}`, 'text-danger'), `text-${name} is not a colour`).toBe(`text-${name} text-danger`)
      },
    },
    { namespace: 'spacing', check: (name) => expect(cn('p-4', `p-${name}`), `p-${name}`).toBe(`p-${name}`) },
    { namespace: 'radius', check: (name) => expect(cn('rounded-sm', `rounded-${name}`), `rounded-${name}`).toBe(`rounded-${name}`) },
    {
      namespace: 'shadow',
      check: (name) => {
        expect(cn('shadow-sm', `shadow-${name}`), `shadow-${name}`).toBe(`shadow-${name}`)
        expect(cn(`shadow-${name}`, 'shadow-black/10'), `shadow-${name} is not a colour`).toBe(`shadow-${name} shadow-black/10`)
      },
    },
    { namespace: 'leading', check: (name) => expect(cn('leading-6', `leading-${name}`), `leading-${name}`).toBe(`leading-${name}`) },
    { namespace: 'tracking', check: (name) => expect(cn('tracking-wide', `tracking-${name}`), `tracking-${name}`).toBe(`tracking-${name}`) },
    { namespace: 'container', check: (name) => expect(cn('max-w-sm', `max-w-${name}`), `max-w-${name}`).toBe(`max-w-${name}`) },
    { namespace: 'ease', check: (name) => expect(cn('ease-in', `ease-${name}`), `ease-${name}`).toBe(`ease-${name}`) },
  ]

  it.each(checks.map((entry) => [entry.namespace, entry] as const))('knows every --%s-* token', (_namespace, entry) => {
    const names = themeTokens(entry.namespace)
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) entry.check(name)
  })
})
