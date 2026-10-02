import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Webfonts are self-hosted from src/app/fonts with next/font/local. next/font/google fetches
 * its CSS from Google Fonts during every cold build, and when that fetch failed the build
 * failed with it (Vercel on 25 and 27 September and 1 October 2026). One import of the Google
 * loader anywhere in src brings the network dependency back.
 */
const SRC = join(process.cwd(), 'src')
const FONTS = join(SRC, 'app', 'fonts')

const GOOGLE_LOADER_IMPORT = /from\s+['"]next\/font\/google['"]|(?:import|require)\(\s*['"]next\/font\/google['"]\s*\)/

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found)
    } else if (/\.(tsx?|mjs|js)$/.test(entry)) {
      found.push(full)
    }
  }
  return found
}

describe('webfonts are self-hosted', () => {
  it('never imports next/font/google, which needs the network at build time', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => GOOGLE_LOADER_IMPORT.test(readFileSync(file, 'utf8')))
      .map((file) => relative(process.cwd(), file))

    expect(offenders).toEqual([])
  })

  it('ships each font file with its licence, as the SIL Open Font License requires', () => {
    const fonts = readdirSync(FONTS).filter((entry) => entry.endsWith('.woff2'))
    expect(fonts.length).toBeGreaterThan(0)

    const unlicensed = fonts.filter((font) => {
      const family = font.replace(/-latin\.woff2$/, '')
      return !existsSync(join(FONTS, `OFL-${family}.txt`))
    })

    expect(unlicensed).toEqual([])
  })
})
