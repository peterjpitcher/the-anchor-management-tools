import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHART_SERIES, DOCUMENT_PALETTE, GUEST, STAFF } from '@/lib/brand/palette'

/** Every token in the @theme static block, with var() references resolved. */
function themeTokens(): Map<string, string> {
  const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8')
  const start = css.indexOf('@theme static {')
  const block = css.slice(start, css.indexOf('\n}\n', start))
  const raw = new Map<string, string>()
  for (const match of block.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) raw.set(match[1], match[2].trim())
  const resolveValue = (value: string, depth = 0): string => {
    const ref = value.match(/^var\((--[a-z0-9-]+)\)$/)
    if (!ref || depth > 5) return value
    return resolveValue(raw.get(ref[1]) ?? value, depth + 1)
  }
  return new Map([...raw].map(([name, value]) => [name, resolveValue(value).toLowerCase()]))
}

const STAFF_TOKENS: Record<keyof typeof STAFF, string> = {
  text: '--color-text',
  textStrong: '--color-text-strong',
  textMuted: '--color-text-muted',
  textSoft: '--color-text-soft',
  textSubtle: '--color-text-subtle',
  bg: '--color-bg',
  surface: '--color-surface',
  surface2: '--color-surface-2',
  surfaceHover: '--color-surface-hover',
  border: '--color-border',
  borderStrong: '--color-border-strong',
  primary: '--color-primary',
  primaryHover: '--color-primary-hover',
  primarySoft: '--color-primary-soft',
  primarySoftFg: '--color-primary-soft-fg',
  primaryFg: '--color-primary-fg',
  success: '--color-success',
  successSoft: '--color-success-soft',
  successFg: '--color-success-fg',
  successBorder: '--color-success-border',
  warning: '--color-warning',
  warningSoft: '--color-warning-soft',
  warningFg: '--color-warning-fg',
  warningBorder: '--color-warning-border',
  danger: '--color-danger',
  dangerSoft: '--color-danger-soft',
  dangerFg: '--color-danger-fg',
  dangerBorder: '--color-danger-border',
  info: '--color-info',
  infoSoft: '--color-info-soft',
  infoFg: '--color-info-fg',
  infoBorder: '--color-info-border',
}

const GUEST_TOKENS: Record<keyof typeof GUEST, string> = {
  green: '--color-anchor-green',
  greenDeep: '--color-anchor-green-deep',
  greenLight: '--color-anchor-green-light',
  gold: '--color-anchor-gold',
  goldDark: '--color-anchor-gold-dark',
  goldDeep: '--color-anchor-gold-deep',
  goldBright: '--color-anchor-gold-bright',
  cream: '--color-anchor-cream',
  creamText: '--color-anchor-cream-text',
  charcoal: '--color-anchor-charcoal',
  sand: '--color-anchor-sand',
  success: '--color-anchor-success',
  danger: '--color-anchor-danger',
  bg: '--color-guest-bg',
  surface: '--color-guest-surface',
  sunk: '--color-guest-sunk',
  border: '--color-guest-border',
  borderStrong: '--color-guest-border-strong',
  text: '--color-guest-text',
  textStrong: '--color-guest-text-strong',
  textMuted: '--color-guest-text-muted',
  accentText: '--color-guest-accent-text',
  buttonBg: '--color-anchor-gold-dark',
  buttonText: '--color-primary-fg',
}

describe('email and document colours match the design tokens', () => {
  const tokens = themeTokens()

  it.each(Object.entries(STAFF_TOKENS))('STAFF.%s is %s', (key, token) => {
    expect(STAFF[key as keyof typeof STAFF].toLowerCase()).toBe(tokens.get(token))
  })

  it.each(Object.entries(GUEST_TOKENS))('GUEST.%s is %s', (key, token) => {
    expect(GUEST[key as keyof typeof GUEST].toLowerCase()).toBe(tokens.get(token))
  })

  it('pins the chart series', () => {
    CHART_SERIES.forEach((hex, index) => {
      expect(hex.toLowerCase()).toBe(tokens.get(`--color-chart-${index + 1}`))
    })
  })

  it('keeps the receipt PDF greys a subset of STAFF', () => {
    expect(DOCUMENT_PALETTE).toEqual({
      text: STAFF.text,
      textMuted: STAFF.textMuted,
      border: STAFF.border,
      surface2: STAFF.surface2,
    })
  })
})
