import { describe, expect, it } from 'vitest'
import { safePortalNextPath, safeRelativePath } from '@/lib/portal/next-path'

// A backslash, built at run time so nothing here depends on how the file is escaped.
const BS = String.fromCharCode(92)

describe('safeRelativePath', () => {
  it('keeps an ordinary path with its query and hash', () => {
    expect(safeRelativePath('/employees?tab=training#top')).toBe('/employees?tab=training#top')
    expect(safeRelativePath('  /dashboard  ')).toBe('/dashboard')
  })

  it.each([
    ['nothing', undefined],
    ['a number', 42],
    ['an empty string', ''],
    ['a bare word', 'dashboard'],
    ['a protocol-relative link', '//evil.example/portal/training'],
    ['a full link', 'https://evil.example/portal/training'],
    ['a script link', 'javascript:alert(1)'],
    ['a slash then backslash', `/${BS}evil.example`],
    ['a backslash anywhere', `/portal${BS}training`],
    ['a tab', '/portal/\ttraining'],
    ['a space', '/portal/ training'],
    ['a newline', '/portal/training\n'.padEnd(20, 'x')],
    ['an over-long value', `/${'a'.repeat(3000)}`],
    // Each of these looks like a path on this site, but normalises to `//evil.example`, which a
    // browser (and Next's router) reads as another site.
    ['a dot segment before a double slash', '/.//evil.example'],
    ['a climb before a double slash', '/a/..//evil.example'],
    ['an encoded dot before a double slash', '/%2e//evil.example'],
    ['a climb from the root before a double slash', '/..//evil.example/path'],
    ['a climb out of a sign-in page', '/auth/..//evil.example'],
    ['an encoded climb before a double slash', '/x/%2e%2e//evil.example'],
  ])('refuses %s', (_label, raw) => {
    expect(safeRelativePath(raw)).toBeNull()
  })

  it('still normalises a dot segment that stays on this site', () => {
    expect(safeRelativePath('/portal/./training')).toBe('/portal/training')
    expect(safeRelativePath('/a/../dashboard?x=1')).toBe('/dashboard?x=1')
  })

  it('only ever returns a path that resolves to this site', () => {
    const inputs = ['/.//evil.example', '/a/..//evil.example', '/%2e//evil.example', '/..//x', '/./', '/a/./b', '/%2e%2e/%2e%2e//e']
    for (const input of inputs) {
      const result = safeRelativePath(input)
      if (result === null) continue
      expect(result.startsWith('//')).toBe(false)
      expect(new URL(result, 'https://management.example').origin).toBe('https://management.example')
    }
  })
})

describe('safePortalNextPath', () => {
  it('honours a link inside the portal', () => {
    expect(safePortalNextPath('/portal/training')).toBe('/portal/training')
    expect(safePortalNextPath('/portal/training/9b2f4a8e-1c1d-4e0e-9a51-0c6b2c1e7f00')).toBe(
      '/portal/training/9b2f4a8e-1c1d-4e0e-9a51-0c6b2c1e7f00',
    )
    expect(safePortalNextPath('/portal/leave?from=email')).toBe('/portal/leave?from=email')
  })

  it.each([
    ['the portal root without a page', '/portal'],
    ['a staff page', '/dashboard'],
    ['a look-alike prefix', '/portalx/training'],
    ['a double slash inside', '/portal//training'],
    ['a climb out of the portal', '/portal/../dashboard'],
    ['an encoded climb', '/portal/%2e%2e/dashboard'],
    ['a dot segment', '/portal/./training'],
    ['an encoded slash', '/portal/%2F%2Fevil.example'],
    ['an encoded backslash', '/portal/%5Cevil.example'],
    ['another site', 'https://evil.example/portal/training'],
    ['a protocol-relative link', '//evil.example/portal/training'],
    ['a backslash trick', `/${BS}evil.example/portal/training`],
    ['a sign-in page', '/auth/login'],
    ['not a string', { href: '/portal/training' }],
  ])('refuses %s', (_label, raw) => {
    expect(safePortalNextPath(raw)).toBeNull()
  })

  it('only allows the portal prefix in the path, not in the query', () => {
    expect(safePortalNextPath('/dashboard?next=/portal/training')).toBeNull()
  })
})
