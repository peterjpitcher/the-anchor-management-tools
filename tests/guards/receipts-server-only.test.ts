import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A file that starts with 'use server' turns every function it exports into an endpoint a
 * browser can call. That is right for src/app/actions, where each function checks permission
 * first, and wrong for the libraries underneath, which trust their caller.
 *
 * Two library files carried the directive: the OpenAI config module, which returns the API
 * key, and the receipts AI classifier, which the build listed as callable with no permission
 * check. Neither needs it. This guard keeps it out of the receipts libraries and services.
 */

const ROOT = process.cwd()
const GUARDED_DIRECTORIES = ['src/lib/receipts', 'src/services/receipts', 'src/lib/openai']
const GUARDED_FILES = ['src/lib/openai.ts']

function sourceFiles(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(join(ROOT, directory))) {
    const relative = `${directory}/${entry}`
    if (statSync(join(ROOT, relative)).isDirectory()) {
      found.push(...sourceFiles(relative))
    } else if (/\.tsx?$/.test(entry)) {
      found.push(relative)
    }
  }
  return found
}

function startsWithUseServer(path: string): boolean {
  const firstStatement = readFileSync(join(ROOT, path), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('/*') && !line.startsWith('*'))
  return /^['"]use server['"];?$/.test(firstStatement ?? '')
}

describe('receipts libraries are not server actions', () => {
  const files = [...GUARDED_DIRECTORIES.flatMap(sourceFiles), ...GUARDED_FILES]

  it('finds the files it is meant to guard', () => {
    expect(files).toContain('src/lib/receipts/ai-classification.ts')
    expect(files).toContain('src/lib/openai/config.ts')
    expect(files).toContain('src/services/receipts/receiptMutations.ts')
  })

  it('none of them starts with a use server directive', () => {
    expect(files.filter(startsWithUseServer)).toEqual([])
  })

  it('the receipts actions file, which should be one, still is', () => {
    expect(startsWithUseServer('src/app/actions/receipts.ts')).toBe(true)
  })
})
