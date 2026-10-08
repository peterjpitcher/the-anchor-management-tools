import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  API_KEY_SCOPES,
  API_KEY_SCOPE_OPTIONS,
  API_KEY_WILDCARD_SCOPE,
  isKnownApiKeyScope,
} from '@/lib/api/scopes'

/**
 * The API keys screen must be able to grant every permission a route asks for.
 * Site review of 7 October 2026, finding MG-011.
 *
 * The screen kept its own list and fell six scopes behind the routes, all six
 * needed by the public website's key. Reissuing that key from the screen would
 * have broken parking, dropped job applications and silenced payment failure
 * alerts, with nothing on screen to say so.
 *
 * withApiAuth's parameter is typed against the shared list, so the compiler
 * catches a new scope passed to it. This suite catches the rest: a scope
 * checked by hand inside a handler, one held in a constant, and a list entry
 * marked as used when no route asks for it.
 */

// The whole of src, because a route may hold its scope in a constant under
// src/lib (the payment failure alert does). Nothing else in src is shaped like
// a scope; if that ever changes this suite will say which file.
const SOURCE_ROOT = join(process.cwd(), 'src')

// The list itself, and the screen that renders it.
const NOT_A_ROUTE = new Set([
  'src/lib/api/scopes.ts',
  'src/app/(authenticated)/settings/api-keys/ApiKeysManager.tsx',
])

// Any quoted token shaped like a scope: word:word, or word:word:word.
const SCOPE_LITERAL = /['"`]((?:read|write|create|parking|payments|delete|manage)(?::[a-z_]+){1,2})['"`]/g

function routeFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__') continue
      found.push(...routeFiles(path))
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      found.push(path)
    }
  }
  return found
}

function scopesAskedForByRoutes(): Map<string, string[]> {
  const asked = new Map<string, string[]>()
  for (const file of routeFiles(SOURCE_ROOT)) {
    if (NOT_A_ROUTE.has(relative(process.cwd(), file))) continue
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(SCOPE_LITERAL)) {
      const scope = match[1]
      const files = asked.get(scope) ?? []
      files.push(relative(process.cwd(), file))
      asked.set(scope, files)
    }
  }
  return asked
}

describe('API key scopes: one shared list', () => {
  const asked = scopesAskedForByRoutes()
  const optionValues = API_KEY_SCOPE_OPTIONS.map((option) => option.value)

  it('finds the routes it is meant to be reading', () => {
    // Guards the scan itself: if the folder moves, an empty map would pass everything.
    expect(asked.size).toBeGreaterThanOrEqual(10)
    expect(asked.has('create:bookings')).toBe(true)
  })

  it('lists every scope a route asks for, so the screen can grant it', () => {
    const missing = [...asked.entries()]
      .filter(([scope]) => !isKnownApiKeyScope(scope))
      .map(([scope, files]) => `${scope} (asked for in ${files[0]})`)

    expect(missing).toEqual([])
  })

  it('offers every listed scope as a tick box on the screen, plus the wildcard', () => {
    for (const scope of API_KEY_SCOPES) {
      expect(optionValues).toContain(scope.value)
    }
    expect(optionValues).toContain(API_KEY_WILDCARD_SCOPE)
    expect(new Set(optionValues).size).toBe(optionValues.length)
  })

  it.each([
    ['parking:view'],
    ['parking:availability'],
    ['parking:create'],
    ['write:recruitment'],
    ['write:marketing_conversions'],
    ['write:ops_alerts'],
    ['create:bookings'],
    ['payments:capture'],
    ['read:customers'],
    ['read:table_bookings'],
    ['read:menu'],
    ['read:events'],
  ])('can grant %s, which the website key depends on', (scope) => {
    expect(optionValues).toContain(scope)
  })

  it('marks a scope as used exactly when a route asks for it', () => {
    const wronglyUsed = API_KEY_SCOPES.filter((scope) => scope.usedByRoutes && !asked.has(scope.value))
    const wronglyUnused = API_KEY_SCOPES.filter((scope) => !scope.usedByRoutes && asked.has(scope.value))

    expect(wronglyUsed.map((scope) => scope.value)).toEqual([])
    expect(wronglyUnused.map((scope) => scope.value)).toEqual([])
  })

  it('says so on the label when no route uses a scope', () => {
    for (const scope of API_KEY_SCOPES) {
      const option = API_KEY_SCOPE_OPTIONS.find((candidate) => candidate.value === scope.value)
      expect(option?.label.includes('no route uses this')).toBe(!scope.usedByRoutes)
    }
  })

  it('the screen builds its tick boxes from the shared list and keeps no list of its own', () => {
    const screen = readFileSync(
      join(process.cwd(), 'src/app/(authenticated)/settings/api-keys/ApiKeysManager.tsx'),
      'utf8'
    )

    expect(screen).toContain('API_KEY_SCOPE_OPTIONS')
    // A { value: 'scope', label: ... } entry typed into the screen is a second list.
    expect(screen).not.toMatch(/value:\s*['"`][a-z*]/)
  })

  it('withApiAuth is typed against the shared list', () => {
    const auth = readFileSync(join(process.cwd(), 'src/lib/api/auth.ts'), 'utf8')
    expect(auth).toMatch(/requiredPermissions: ApiKeyScope\[\]/)
  })
})
