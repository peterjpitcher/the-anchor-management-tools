import fs from 'node:fs'
import path from 'node:path'

type ScriptCase = {
  file: string
  runEnv: string
  allowEnv: string
}

const CASES: ScriptCase[] = [
  {
    file: 'scripts/menu/seed-chefs-essentials-chips.js',
    runEnv: 'RUN_SEED_CHEFS_ESSENTIALS_CHIPS_MUTATION',
    allowEnv: 'ALLOW_SEED_CHEFS_ESSENTIALS_CHIPS_MUTATION_SCRIPT',
  },
  {
    file: 'scripts/menu/seed-chefs-larder-slow-cooked-lamb-shanks.js',
    runEnv: 'RUN_SEED_CHEFS_LARDER_SLOW_COOKED_LAMB_SHANKS_MUTATION',
    allowEnv: 'ALLOW_SEED_CHEFS_LARDER_SLOW_COOKED_LAMB_SHANKS_MUTATION_SCRIPT',
  },
  {
    file: 'scripts/menu/seed-chefs-larder-garden-peas.js',
    runEnv: 'RUN_SEED_CHEFS_LARDER_GARDEN_PEAS_MUTATION',
    allowEnv: 'ALLOW_SEED_CHEFS_LARDER_GARDEN_PEAS_MUTATION_SCRIPT',
  },
  {
    file: 'scripts/menu/seed-chefs-larder-buttery-mash.js',
    runEnv: 'RUN_SEED_CHEFS_LARDER_BUTTERY_MASH_MUTATION',
    allowEnv: 'ALLOW_SEED_CHEFS_LARDER_BUTTERY_MASH_MUTATION_SCRIPT',
  },
  {
    file: 'scripts/menu/seed-chefs-larder-sweet-potato-fries.js',
    runEnv: 'RUN_SEED_CHEFS_LARDER_SWEET_POTATO_FRIES_MUTATION',
    allowEnv: 'ALLOW_SEED_CHEFS_LARDER_SWEET_POTATO_FRIES_MUTATION_SCRIPT',
  },
  {
    file: 'scripts/menu/seed-menu-dishes.js',
    runEnv: 'RUN_SEED_MENU_DISHES_MUTATION',
    allowEnv: 'ALLOW_SEED_MENU_DISHES_MUTATION_SCRIPT',
  },
  {
    file: 'scripts/menu/seed-menu-dishes.ts',
    runEnv: 'RUN_SEED_MENU_DISHES_MUTATION',
    allowEnv: 'ALLOW_SEED_MENU_DISHES_MUTATION_SCRIPT',
  },
]

describe('scripts/menu seed scripts safety defaults', () => {
  for (const entry of CASES) {
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
      expect(script).not.toContain('Number.parseInt')

      // Fail-closed: scripts should not use process.exit(...) patterns.
      expect(script).not.toContain('process.exit(')
      expect(script).toContain('process.exitCode')
    })
  }
})
