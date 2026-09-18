import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STAFF } from '@/lib/brand/palette'

/**
 * The palette exists because emails and PDFs cannot read CSS variables. It must never become
 * a second colour system: every entry has to equal its token in src/app/globals.css.
 */

/** Tokens declared in the first `@theme` block, with one level of var() resolved. */
function themeTokens(): Map<string, string> {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
  const start = css.search(/@theme\b[^{]*\{/)
  if (start < 0) throw new Error('globals.css has no @theme block')
  const open = css.indexOf('{', start)
  const close = css.indexOf('\n}', open)
  const tokens = new Map<string, string>()
  for (const match of css.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(match[1], match[2].trim())
  }
  for (const [name, value] of tokens) {
    const reference = /^var\((--[\w-]+)\)$/.exec(value)
    const resolved = reference ? tokens.get(reference[1]) : undefined
    if (resolved) tokens.set(name, resolved)
  }
  return tokens
}

const TOKEN_FOR: Record<keyof typeof STAFF, string> = {
  text: '--color-text',
  textMuted: '--color-text-muted',
  borderStrong: '--color-border-strong',
}

describe('brand palette', () => {
  it('names a globals.css token for every staff colour', () => {
    expect(Object.keys(STAFF).sort()).toEqual(Object.keys(TOKEN_FOR).sort())
  })

  it('matches every staff colour to its token in globals.css', () => {
    const tokens = themeTokens()
    for (const [key, token] of Object.entries(TOKEN_FOR) as Array<[keyof typeof STAFF, string]>) {
      const value = tokens.get(token)
      expect(value, `${token} is missing from globals.css`).toBeDefined()
      expect(STAFF[key].toLowerCase(), `STAFF.${key} has drifted from ${token}`).toBe(value?.toLowerCase())
    }
  })
})
