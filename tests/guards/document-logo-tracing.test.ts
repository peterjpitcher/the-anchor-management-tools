import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The document logo helpers read their PNG from the deployment bundle and render the document
 * without a logo, with no error, when the file is not there. Next only ships a public/ file with
 * a route when it is named in outputFileTracingIncludes or its tracer happens to spot the read,
 * and on 5 October 2026 the tracer missed The Anchor logo for the private booking page. So both
 * logos are named for every route. This guard fails if that entry is dropped or a helper is
 * pointed at a file the entry does not name.
 */
const CONFIG = fs.readFileSync(path.join(process.cwd(), 'next.config.mjs'), 'utf8')

function logoPathIn(helperFile: string): string {
  const source = fs.readFileSync(path.join(process.cwd(), helperFile), 'utf8')
  const match = source.match(/const LOGO_RELATIVE_PATH = '([^']+)'/)
  expect(match, `${helperFile} should declare LOGO_RELATIVE_PATH`).not.toBeNull()
  return match![1]
}

/** The file list of the include entry that applies to every route. */
function everyRouteIncludes(): string {
  const match = CONFIG.match(/'\/\*\*':\s*\[([^\]]*)\]/)
  expect(match, "next.config.mjs should have a '/**' entry in outputFileTracingIncludes").not.toBeNull()
  return match![1]
}

describe('document logos are bundled with every route', () => {
  it.each(['src/lib/pdf/document-logo.ts', 'src/lib/pdf/anchor-logo.ts'])('%s', (helperFile) => {
    const logoPath = logoPathIn(helperFile)

    expect(fs.existsSync(path.join(process.cwd(), logoPath)), `${logoPath} should exist`).toBe(true)
    expect(everyRouteIncludes()).toContain(`'./${logoPath}'`)
  })
})
