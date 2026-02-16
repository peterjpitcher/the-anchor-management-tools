import fs from 'node:fs'
import path from 'node:path'

type MutationScriptCase = {
  file: string
  runEnv: string
  allowEnv: string
}

const MUTATION_CASES: MutationScriptCase[] = [
  {
    file: 'scripts/oj-projects/fix-typo.ts',
    runEnv: 'RUN_OJ_FIX_TYPO_MUTATION',
    allowEnv: 'ALLOW_OJ_FIX_TYPO_MUTATION_SCRIPT',
  },
  {
    file: 'scripts/oj-projects/move-to-website-content.ts',
    runEnv: 'RUN_OJ_MOVE_TO_WEBSITE_CONTENT_MUTATION',
    allowEnv: 'ALLOW_OJ_MOVE_TO_WEBSITE_CONTENT_MUTATION_SCRIPT',
  },
  {
    file: 'scripts/oj-projects/update-barons-retainer-hours.ts',
    runEnv: 'RUN_OJ_UPDATE_BARONS_RETAINER_HOURS_MUTATION',
    allowEnv: 'ALLOW_OJ_UPDATE_BARONS_RETAINER_HOURS_MUTATION_SCRIPT',
  },
  {
    file: 'scripts/oj-projects/fix-entry-rates.ts',
    runEnv: 'RUN_OJ_FIX_ENTRY_RATES_MUTATION',
    allowEnv: 'ALLOW_OJ_FIX_ENTRY_RATES_MUTATION_SCRIPT',
  },
  {
    file: 'scripts/oj-projects/add-barons-pubs-entries.ts',
    runEnv: 'RUN_OJ_ADD_BARONS_PUBS_ENTRIES_MUTATION',
    allowEnv: 'ALLOW_OJ_ADD_BARONS_PUBS_ENTRIES_MUTATION_SCRIPT',
  },
  {
    file: 'scripts/oj-projects/update-barons-retainer.ts',
    runEnv: 'RUN_OJ_UPDATE_BARONS_RETAINER_MUTATION',
    allowEnv: 'ALLOW_OJ_UPDATE_BARONS_RETAINER_MUTATION_SCRIPT',
  },
  {
    file: 'scripts/oj-projects/move-all-to-retainers.ts',
    runEnv: 'RUN_OJ_MOVE_ALL_TO_RETAINERS_MUTATION',
    allowEnv: 'ALLOW_OJ_MOVE_ALL_TO_RETAINERS_MUTATION_SCRIPT',
  },
]

const READ_ONLY_SCRIPTS = [
  'scripts/oj-projects/find-barons-projects.ts',
  'scripts/oj-projects/find-retainers.ts',
  'scripts/oj-projects/list-january.ts',
  'scripts/oj-projects/debug-november.ts',
  'scripts/oj-projects/debug-snapshots.ts',
  'scripts/oj-projects/debug-vision.ts',
  'scripts/oj-projects/find-barons-ids.ts',
  'scripts/oj-projects/check-golden-barrels.ts',
  'scripts/oj-projects/debug-constraint.ts',
  'scripts/oj-projects/verify-monthly-hours.ts',
  'scripts/oj-projects/verify-barons-entries.ts',
  'scripts/oj-projects/verify-project-stats.ts',
  'scripts/oj-projects/verify-retainer-updates.ts',
  'scripts/oj-projects/verify-user-list.ts',
]

describe('scripts/oj-projects safety defaults', () => {
  for (const entry of MUTATION_CASES) {
    it(`${entry.file} defaults to dry-run and requires multi-gating + caps`, () => {
      const scriptPath = path.resolve(process.cwd(), entry.file)
      const script = fs.readFileSync(scriptPath, 'utf8')

      expect(script).toContain('DRY RUN')
      expect(script).toContain('--confirm')
      expect(script).toContain('--dry-run')
      expect(script).toContain('--limit')
      expect(script).toContain(entry.runEnv)
      expect(script).toContain(entry.allowEnv)
      expect(script).toContain('/^[1-9]\\d*$/')
      expect(script).toContain('Invalid positive integer')
      expect(script).toContain('Number.isInteger')
      expect(script).not.toContain('const parsed = Number.parseInt(raw, 10)')

      expect(script).not.toContain('process.exit(')
      expect(script).toContain('process.exitCode')
    })
  }

  it('verify-closing-logic is strictly read-only and blocks --confirm', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/oj-projects/verify-closing-logic.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('read-only')
    expect(script).toContain('--confirm')
    expect(script).not.toContain('.insert(')
    expect(script).not.toContain('.update(')
    expect(script).not.toContain('.delete(')
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('read-only OJ scripts fail closed and block --confirm', () => {
    for (const relativePath of READ_ONLY_SCRIPTS) {
      const scriptPath = path.resolve(process.cwd(), relativePath)
      const script = fs.readFileSync(scriptPath, 'utf8')

      expect(script).toContain('read-only')
      expect(script).toContain('--confirm')
      expect(script).toContain('does not support --confirm')
      expect(script).toContain('createAdminClient')
      expect(script).toContain('assertScriptQuerySucceeded')

      expect(script).not.toContain('.insert(')
      expect(script).not.toContain('.update(')
      expect(script).not.toContain('.delete(')

      expect(script).not.toContain('process.exit(')
      expect(script).toContain('process.exitCode')
    }
  })
})
