import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveColour, tokens } from '@/ds/tokens'

function themeNames(): Set<string> {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
  const start = css.indexOf('@theme static {')
  expect(start, 'globals.css must keep an @theme static block').toBeGreaterThanOrEqual(0)
  const block = css.slice(start, css.indexOf('\n}\n', start))
  return new Set([...block.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((match) => match[1]))
}

function varNames(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/var\((--[a-z0-9-]+)\)/g)) found.push(match[1])
  } else if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) varNames(inner, found)
  }
  return found
}

describe('JS token accessors', () => {
  it('only names tokens that exist in globals.css', () => {
    const defined = themeNames()
    const missing = varNames(tokens).filter((name) => !defined.has(name))
    expect(missing).toEqual([])
  })

  it('passes literal colours through and resolves var() references', () => {
    expect(resolveColour('#123456')).toBe('#123456')
    document.documentElement.style.setProperty('--color-chart-1', '#006A4E')
    expect(resolveColour('var(--color-chart-1)')).toBe('#006A4E')
    document.documentElement.style.removeProperty('--color-chart-1')
  })
})
