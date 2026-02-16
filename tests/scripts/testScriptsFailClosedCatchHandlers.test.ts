import fs from 'node:fs'
import path from 'node:path'

function listFilesRecursively(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const resolved = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(resolved))
      continue
    }

    if (entry.isFile()) {
      files.push(resolved)
    }
  }

  return files
}

describe('scripts fail-closed regression guards', () => {
  it('does not allow .catch(console.error) which can exit 0 on failure', () => {
    const scriptsRoot = path.resolve(process.cwd(), 'scripts')
    const files = listFilesRecursively(scriptsRoot)

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8')
      expect(content).not.toContain('.catch(console.error)')
    }
  })

  it('keeps fix utility scripts read-only by default and fail-closed', () => {
    const fixApiAccessSimple = path.resolve(process.cwd(), 'scripts/fixes/fix-api-access-simple.ts')
    const fixGoogleServiceKey = path.resolve(process.cwd(), 'scripts/fixes/fix-google-service-key.ts')

    const apiScript = fs.readFileSync(fixApiAccessSimple, 'utf8')
    expect(apiScript).toContain('read-only')
    expect(apiScript).toContain('--confirm')
    expect(apiScript).toContain('--key-hash')
    expect(apiScript).toContain('API_KEY_HASH')
    expect(apiScript).toContain('createAdminClient')
    expect(apiScript).toContain('assertScriptQuerySucceeded')
    expect(apiScript).not.toContain('@supabase/supabase-js')
    expect(apiScript).not.toContain('33d30abf849cac33c3537d83fae428d1a38b6c2fb41dea79fb8d4fc872ff64a5')
    expect(apiScript).not.toContain('process.exit(')
    expect(apiScript).toContain('process.exitCode = 1')

    const googleScript = fs.readFileSync(fixGoogleServiceKey, 'utf8')
    expect(googleScript).toContain('read-only')
    expect(googleScript).toContain('--confirm')
    expect(googleScript).toContain('--write-json')
    expect(googleScript).toContain('--output-path')
    expect(googleScript).not.toContain('process.exit(')
    expect(googleScript).toContain('process.exitCode = 1')
  })
})
