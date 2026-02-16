import fs from 'node:fs'
import path from 'node:path'

describe('Additional mutation scripts safety defaults', () => {
  const STRICT_CAP_PARSER_SCRIPTS = [
    'scripts/clear-cashing-up-data.ts',
    'scripts/verify-hiring-flow.ts',
    'scripts/seed-cashing-up.ts',
    'scripts/seed-cashup-targets.ts',
    'scripts/clear-2025-data.ts',
    'scripts/fix-bookings-is-reminder-only.ts',
    'scripts/setup-dev-user.ts',
    'scripts/apply-event-categorization.ts',
    'scripts/insert-golden-barrels-hours.ts',
    'scripts/rectify-golden-barrels.ts',
    'scripts/reprocess-cvs.ts',
    'scripts/trigger-invoice-reminders.ts',
    'scripts/import-employee-documents.ts',
  ]

  it('mutation scripts enforce strict positive-integer cap parsing', () => {
    for (const relativePath of STRICT_CAP_PARSER_SCRIPTS) {
      const scriptPath = path.resolve(process.cwd(), relativePath)
      const script = fs.readFileSync(scriptPath, 'utf8')

      expect(script).toContain('/^[1-9]\\d*$/')
      expect(script).toContain('Invalid positive integer')
      expect(script).toContain('Number.isInteger')
      expect(script).not.toContain('const parsed = Number.parseInt(raw, 10)')
    }
  })

  it('clear-cashing-up-data defaults to dry-run and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/clear-cashing-up-data.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('RUN_CLEAR_CASHING_UP_DATA_MUTATION')
    expect(script).toContain('ALLOW_CLEAR_CASHING_UP_DATA_MUTATION_SCRIPT')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('verify-hiring-flow defaults to dry-run and is multi-gated', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/verify-hiring-flow.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('RUN_VERIFY_HIRING_FLOW_MUTATION')
    expect(script).toContain('ALLOW_VERIFY_HIRING_FLOW_MUTATION_SCRIPT')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('seed-cashing-up defaults to dry-run and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/seed-cashing-up.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('RUN_SEED_CASHING_UP_MUTATION')
    expect(script).toContain('ALLOW_SEED_CASHING_UP_MUTATION_SCRIPT')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('seed-cashup-targets defaults to dry-run and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/seed-cashup-targets.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('--site-id')
    expect(script).toContain('RUN_SEED_CASHUP_TARGETS_MUTATION')
    expect(script).toContain('ALLOW_SEED_CASHUP_TARGETS_MUTATION_SCRIPT')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('clear-2025-data defaults to dry-run and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/clear-2025-data.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('RUN_CLEAR_2025_DATA_MUTATION')
    expect(script).toContain('ALLOW_CLEAR_2025_DATA_MUTATION_SCRIPT')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('fix-bookings-is-reminder-only defaults to dry-run and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/fix-bookings-is-reminder-only.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('RUN_FIX_BOOKINGS_IS_REMINDER_ONLY_MUTATION')
    expect(script).toContain('ALLOW_FIX_BOOKINGS_IS_REMINDER_ONLY_MUTATION_SCRIPT')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('setup-dev-user defaults to dry-run and is multi-gated with explicit cap enforcement', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/setup-dev-user.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit=1')
    expect(script).toContain('--email')
    expect(script).toContain('--password')
    expect(script).toContain('--role')
    expect(script).toContain('RUN_SETUP_DEV_USER_MUTATION')
    expect(script).toContain('ALLOW_SETUP_DEV_USER_MUTATION_SCRIPT')
    expect(script).toContain('mutation requires --limit=1')
    expect(script).toContain('--limit exceeds hard cap')
    expect(script).toContain('--limit must be ${HARD_CAP}')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('debug-outstanding fails closed on errors (no .catch(console.error))', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/debug-outstanding.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).not.toContain('.catch(console.error)')
    expect(script).toContain('process.exitCode')
  })

  it('apply-event-categorization defaults to dry-run and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/apply-event-categorization.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('RUN_APPLY_EVENT_CATEGORIZATION_MUTATION')
    expect(script).toContain('ALLOW_APPLY_EVENT_CATEGORIZATION_MUTATION_SCRIPT')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('import-employee-documents defaults to dry-run and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/import-employee-documents.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--limit')
    expect(script).toContain('RUN_IMPORT_EMPLOYEE_DOCUMENTS_MUTATION')
    expect(script).toContain('ALLOW_IMPORT_EMPLOYEE_DOCUMENTS_MUTATION_SCRIPT')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('import-employee-documents requires strict integer --limit parsing for both flag forms', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/import-employee-documents.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('if (arg.startsWith(\'--limit=\'))')
    expect(script).toContain('if (arg === \'--limit\')')
    expect(script).toContain('/^[1-9]\\d*$/')
    expect(script).toContain('Invalid positive integer')
    expect(script).not.toContain('const raw = Number(arg.split(\'=\')[1])')
  })

  it('insert-golden-barrels-hours defaults to dry-run and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/insert-golden-barrels-hours.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('RUN_INSERT_GOLDEN_BARRELS_HOURS_MUTATION')
    expect(script).toContain('ALLOW_INSERT_GOLDEN_BARRELS_HOURS_MUTATION_SCRIPT')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('rectify-golden-barrels defaults to dry-run and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/rectify-golden-barrels.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('--vendor-id')
    expect(script).toContain('--project-id')
    expect(script).toContain('RUN_RECTIFY_GOLDEN_BARRELS_MUTATION')
    expect(script).toContain('ALLOW_RECTIFY_GOLDEN_BARRELS_MUTATION_SCRIPT')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('reprocess-cvs defaults to dry-run and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/reprocess-cvs.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('RUN_REPROCESS_CVS_MUTATION')
    expect(script).toContain('ALLOW_REPROCESS_CVS_MUTATION_SCRIPT')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('trigger-invoice-reminders defaults to dry-run and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/trigger-invoice-reminders.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('--url')
    expect(script).toContain('RUN_TRIGGER_INVOICE_REMINDERS_MUTATION')
    expect(script).toContain('ALLOW_INVOICE_REMINDER_TRIGGER_SCRIPT')

    // Avoid a silent default to production URL in a mutation script.
    expect(script).not.toContain('https://management.orangejelly.co.uk')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })
})
