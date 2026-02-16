import fs from 'node:fs'
import path from 'node:path'

describe('Additional scripts/testing safety and fail-closed guards', () => {
  it('test-slot-generation is strictly read-only and blocks mutation RPC', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-slot-generation.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('read-only')
    expect(script).toContain('--confirm')
    expect(script).toContain('withEqualsPrefix')
    expect(script).toContain('/^[1-9]\\d*$/')
    expect(script).toContain('Invalid positive integer for --weeks')
    expect(script).toContain('Number.isInteger')
    expect(script).toContain('--weeks exceeds hard cap')
    expect(script).not.toContain('Number(value)')
    expect(script).toContain("from '@/lib/supabase/admin'")
    expect(script).toContain('assertScriptQuerySucceeded')
    expect(script).not.toContain("@supabase/supabase-js")
    expect(script).not.toMatch(/\.rpc\(['"]auto_generate_weekly_slots['"]/)
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('test-analytics-function fails closed and does not call process.exit', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-analytics-function.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('read-only')
    expect(script).toContain('--confirm')
    expect(script).toContain("from '@/lib/supabase/admin'")
    expect(script).toContain('assertScriptQuerySucceeded')
    expect(script).not.toContain("@supabase/supabase-js")
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('test-short-link fails closed and does not call process.exit', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-short-link.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('read-only')
    expect(script).toContain('--confirm')
    expect(script).toContain("from '@/lib/supabase/admin'")
    expect(script).toContain('assertScriptQuerySucceeded')
    expect(script).not.toContain("@supabase/supabase-js")
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('test-vip-club-redirect fails closed and does not call process.exit', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-vip-club-redirect.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('read-only')
    expect(script).toContain('--confirm')
    expect(script).toContain("from '@/lib/supabase/admin'")
    expect(script).toContain('assertScriptQuerySucceeded')
    expect(script).not.toContain("@supabase/supabase-js")
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('test-paypal-credentials is dry-run by default and gates order creation', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-paypal-credentials.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('RUN_TEST_PAYPAL_CREDENTIALS_ORDER_CREATE')
    expect(script).toContain('ALLOW_TEST_PAYPAL_CREDENTIALS_ORDER_CREATE_SCRIPT')
    expect(script).toContain('/^[1-9]\\d*$/')
    expect(script).toContain('Invalid positive integer')
    expect(script).toContain('Number.isInteger')
    expect(script).not.toContain('const parsed = Number.parseInt(raw, 10)')
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('test-microsoft-graph-email is dry-run by default and gates external email sending', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-microsoft-graph-email.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('--to')
    expect(script).toContain('RUN_TEST_MICROSOFT_GRAPH_EMAIL_SEND')
    expect(script).toContain('ALLOW_TEST_MICROSOFT_GRAPH_EMAIL_SEND_SCRIPT')
    expect(script).toContain('/^[1-9]\\d*$/')
    expect(script).toContain('Invalid positive integer')
    expect(script).toContain('Number.isInteger')
    expect(script).not.toContain('const parsed = Number.parseInt(raw, 10)')
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('check-shortlink-redirect fails closed and does not call process.exit', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/check-shortlink-redirect.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
    expect(script).toContain('failures')
  })

  it('dump-events-api fails closed and does not call process.exit', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/dump-events-api.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
    expect(script).toContain('Missing API key')
  })

  it('test-connectivity fails closed and does not call process.exit', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-connectivity.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('read-only')
    expect(script).toContain('--confirm')
    expect(script).toContain('does not support --confirm')
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('test-pdf-generation is read-only and does not use the Next.js server supabase client', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-pdf-generation.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('read-only')
    expect(script).toContain('--confirm')
    expect(script).toContain('does not support --confirm')
    expect(script).not.toContain("@/lib/supabase/server")
    expect(script).toContain("from '@/lib/supabase/admin'")
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('test-sunday-lunch-menu is read-only and fails closed on query errors', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-sunday-lunch-menu.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('read-only')
    expect(script).toContain('--confirm')
    expect(script).toContain('does not support --confirm')
    expect(script).not.toContain("@/lib/supabase/server")
    expect(script).toContain("from '@/lib/supabase/admin'")
    expect(script).toContain('assertScriptQuerySucceeded')
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('test-template-loading is strictly read-only and uses the get_message_template RPC', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-template-loading.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('read-only')
    expect(script).toContain('--confirm')
    expect(script).toContain('does not support --confirm')
    expect(script).toContain('/^[1-9]\\d*$/')
    expect(script).toContain('Invalid positive integer')
    expect(script).toContain('Number.isInteger')
    expect(script).toContain('--limit exceeds hard cap')
    expect(script).not.toContain('Number(value)')
    expect(script).toContain("from '@/lib/supabase/admin'")
    expect(script).toContain(".from('message_templates')")
    expect(script).toContain("rpc('get_message_template'")
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('test-template-fix is strictly read-only and uses the get_message_template RPC', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-template-fix.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('read-only')
    expect(script).toContain('--confirm')
    expect(script).toContain('does not support --confirm')
    expect(script).toContain("from '@/lib/supabase/admin'")
    expect(script).toContain("rpc('get_message_template'")
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('test-production-templates is strictly read-only and uses the get_message_template RPC', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-production-templates.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('read-only')
    expect(script).toContain('--confirm')
    expect(script).toContain('does not support --confirm')
    expect(script).toContain('/^[1-9]\\d*$/')
    expect(script).toContain('Invalid positive integer')
    expect(script).toContain('Number.isInteger')
    expect(script).toContain('--limit exceeds hard cap')
    expect(script).not.toContain('Number(value)')
    expect(script).toContain("from '@/lib/supabase/admin'")
    expect(script).toContain(".from('message_templates')")
    expect(script).toContain("rpc('get_message_template'")
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('test-production-template-fix is strictly read-only and uses the get_message_template RPC', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-production-template-fix.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('read-only')
    expect(script).toContain('--confirm')
    expect(script).toContain('does not support --confirm')
    expect(script).toContain("from '@/lib/supabase/admin'")
    expect(script).toContain("rpc('get_message_template'")
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('test-deployment is strictly read-only and fails closed without calling process.exit', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-deployment.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('read-only')
    expect(script).toContain('--confirm')
    expect(script).toContain('does not support --confirm')
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
    expect(script).toContain('fetch(')
  })

  it('test-menu-display is strictly read-only and requires explicit targeting', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-menu-display.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('read-only')
    expect(script).toContain('--confirm')
    expect(script).toContain('does not support --confirm')
    expect(script).toContain('--booking-ref')
    expect(script).toContain('custom_item_name')
    expect(script).toContain('guest_name')
    expect(script).toContain('special_requests')
    expect(script).toContain('item_type')
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })
})
