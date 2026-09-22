import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

/**
 * NEXT_PUBLIC_APP_URL is required at boot (src/lib/env.ts) and links to the app are built from
 * getAppUrl(). A fallback to localhost or to a preview deployment's VERCEL_URL can only hide a
 * missing variable, and the place it would surface is a guest's text or email.
 */
const SRC = join(process.cwd(), 'src')
const ENV_MODULE = join(SRC, 'lib', 'env.ts')

const FALLBACK = /localhost:3000|https:\/\/\$\{(process\.)?env\.VERCEL_URL\}/

/**
 * A hardcoded copy of the live app URL used as a fallback (`|| 'https://management...'`). It
 * hides a missing variable just as well, and pins every environment to production.
 */
const PRODUCTION_URL_FALLBACK = /(\|\||\?\?)\s*['"`]https:\/\/management\.orangejelly\.co\.uk/g

/**
 * Any fallback at all after the variable: the request origin, an empty string (a relative link in
 * a text or email), 'unknown', or another host. getAppUrl() is the one way to read it.
 */
const APP_URL_FALLBACK = /NEXT_PUBLIC_APP_URL\s*(\|\||\?\?)/g

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

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

/** 'use client' or 'use server' when the module opens with that directive. */
function directiveOf(source: string): 'client' | 'server' | null {
  const body = source.replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, '')
  if (/^['"]use client['"]/.test(body)) return 'client'
  if (/^['"]use server['"]/.test(body)) return 'server'
  return null
}

/** The src modules a file pulls into its bundle: static and dynamic imports, not type-only ones. */
function importsOf(file: string, source: string): string[] {
  const found: string[] = []
  const pattern =
    /(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const match of source.matchAll(pattern)) {
    if (match[1]) continue
    const specifier = match[2] ?? match[3]
    const base = specifier.startsWith('@/')
      ? join(SRC, specifier.slice(2))
      : specifier.startsWith('.')
        ? resolve(dirname(file), specifier)
        : null
    if (!base) continue
    const target = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile()
    )
    if (target) found.push(target)
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

  it('never falls back to a hardcoded copy of the production app URL', () => {
    const offences: string[] = []

    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(PRODUCTION_URL_FALLBACK)) {
        offences.push(`${relative(process.cwd(), file)}:${lineOf(source, match.index ?? 0)}`)
      }
    }

    expect(offences).toEqual([])
  })

  it('never falls back to anything else when reading NEXT_PUBLIC_APP_URL', () => {
    const offences: string[] = []

    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(APP_URL_FALLBACK)) {
        offences.push(`${relative(process.cwd(), file)}:${lineOf(source, match.index ?? 0)}`)
      }
    }

    expect(offences).toEqual([])
  })

  it('keeps env.ts out of every browser bundle', () => {
    // env.ts validates server-only variables when it loads, so a client component that reaches it,
    // however indirectly, throws in the browser. Server actions are a boundary: a client component
    // importing one receives a stub that calls the server, not the module itself.
    const modules = new Map<string, { directive: 'client' | 'server' | null; imports: string[] }>()
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, 'utf8')
      modules.set(file, { directive: directiveOf(source), imports: importsOf(file, source) })
    }

    const offences: string[] = []
    for (const [root, info] of modules) {
      if (info.directive !== 'client') continue
      const via = new Map<string, string>([[root, root]])
      const queue = [root]
      while (queue.length > 0) {
        const current = queue.shift() as string
        for (const next of modules.get(current)?.imports ?? []) {
          if (via.has(next) || modules.get(next)?.directive === 'server') continue
          via.set(next, current)
          queue.push(next)
        }
      }
      if (!via.has(ENV_MODULE)) continue
      const chain: string[] = []
      for (let step = ENV_MODULE; step !== root; step = via.get(step) as string) {
        chain.unshift(relative(process.cwd(), step))
      }
      offences.push([relative(process.cwd(), root), ...chain].join(' -> '))
    }

    expect(offences).toEqual([])
  })
})
