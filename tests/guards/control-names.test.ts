import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Every DS switch, checkbox, radio and icon-only button needs a name a screen reader can read.
 * The September 2026 accessibility reviews found icon buttons announced only as "icon button",
 * checkboxes given label="", and switches with no name at all. This guard reads the JSX, so it
 * checks that a name is supplied, not that the name is a good one.
 */
const SRC = join(process.cwd(), 'src')

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== 'node_modules') sourceFiles(path, out)
    } else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

/** The opening tag that starts at `start`, skipping any `>` inside a `{...}` expression. */
function openingTag(text: string, start: number): string {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (char === '{') depth++
    else if (char === '}') depth--
    else if (char === '>' && depth === 0) return text.slice(start, i + 1)
  }
  return text.slice(start)
}

interface Usage {
  where: string
  tag: string
  text: string
}

function usagesOf(component: string): Usage[] {
  const usages: Usage[] = []
  const pattern = new RegExp(`<${component}\\b`, 'g')
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split('\n').length
      usages.push({ where: `${relative(process.cwd(), file)}:${line}`, tag: openingTag(text, match.index ?? 0), text })
    }
  }
  return usages
}

/** A label prop with something in it: label="" names nothing. */
const HAS_LABEL = /\slabel=(?!""|\{''\}|\{""\}|\{``\})/
/** An explicit ARIA name, or a spread that may carry one. */
const HAS_ARIA_NAME = /\saria-label(?:ledby)?=|\{\.\.\./

/** A checkbox or radio can also be named by a <label htmlFor> that matches its id. */
function hasMatchingLabelFor(usage: Usage): boolean {
  const id = usage.tag.match(/\sid=(?:"([^"]+)"|\{([^}]+)\})/)
  if (!id) return false
  const value = (id[1] ?? id[2]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`htmlFor=(?:"${value}"|\\{${value}\\})`).test(usage.text)
}

describe('control names', () => {
  it('names every Switch', () => {
    const unnamed = usagesOf('Switch')
      .filter((usage) => !HAS_LABEL.test(usage.tag) && !HAS_ARIA_NAME.test(usage.tag))
      .map((usage) => usage.where)
    expect(unnamed, 'Give each Switch a label, or an aria-label when the text beside it is not its label.').toEqual([])
  })

  it('names every Checkbox and Radio', () => {
    const unnamed = ['Checkbox', 'Radio']
      .flatMap(usagesOf)
      // An element with children uses them as its label.
      .filter((usage) => usage.tag.endsWith('/>'))
      .filter((usage) => !HAS_LABEL.test(usage.tag) && !HAS_ARIA_NAME.test(usage.tag) && !hasMatchingLabelFor(usage))
      .map((usage) => usage.where)
    expect(unnamed, 'Give each Checkbox and Radio a label, an aria-label, or an id with a matching <label htmlFor>.').toEqual([])
  })

  it('names every IconButton', () => {
    const unnamed = usagesOf('IconButton')
      .filter((usage) => !HAS_LABEL.test(usage.tag) && !HAS_ARIA_NAME.test(usage.tag))
      .map((usage) => usage.where)
    expect(unnamed, 'Give each IconButton a label: a title alone is hidden behind the "icon button" fallback.').toEqual([])
  })
})
