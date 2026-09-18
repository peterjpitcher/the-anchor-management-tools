import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * NEXT_PUBLIC_APP_URL is required at boot (src/lib/env.ts) and links to the app are built from
 * getAppUrl(). A fallback to localhost or to a preview deployment's VERCEL_URL can only hide a
 * missing variable, and the place it would surface is a guest's text or email.
 */
const SRC = join(process.cwd(), 'src')

const FALLBACK = /localhost:3000|https:\/\/\$\{(process\.)?env\.VERCEL_URL\}/

/** The value env.ts supplies only when NODE_ENV is 'test'. */
const TEST_DEFAULT = { file: 'src/lib/env.ts', text: "NEXT_PUBLIC_APP_URL: 'http://localhost:3000'" }

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === '__mocks__') continue
      sourceFiles(full, found)
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      found.push(full)
    }
  }
  return found
}

describe('app URL fallbacks', () => {
  it('never falls back to localhost or VERCEL_URL for the app URL', () => {
    const offences: string[] = []

    for (const file of sourceFiles(SRC)) {
      const path = relative(process.cwd(), file)
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (!FALLBACK.test(line)) return
          if (path === TEST_DEFAULT.file && line.includes(TEST_DEFAULT.text)) return
          offences.push(`${path}:${index + 1}: ${line.trim()}`)
        })
    }

    expect(offences).toEqual([])
  })
})
