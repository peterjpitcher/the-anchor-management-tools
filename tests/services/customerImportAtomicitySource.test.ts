import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const serviceSource = readFileSync(resolve(process.cwd(), 'src/services/customers.ts'), 'utf8')
const actionSource = readFileSync(resolve(process.cwd(), 'src/app/actions/customers.ts'), 'utf8')
const migrationSource = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260708000023_customer_import_atomicity.sql'),
  'utf8'
)
const rollbackSource = readFileSync(
  resolve(process.cwd(), 'supabase/rollbacks/20260708000023_customer_import_atomicity.sql'),
  'utf8'
)
const contactDefaultsMigrationSource = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260712000000_customer_import_contact_defaults.sql'),
  'utf8'
)
const contactDefaultsRollbackSource = readFileSync(
  resolve(process.cwd(), 'supabase/rollbacks/20260712000000_customer_import_contact_defaults.sql'),
  'utf8'
)

function serviceMethodBody(name: string) {
  const start = serviceSource.indexOf(`static async ${name}`)
  const next = serviceSource.indexOf('\n  static async ', start + 1)
  return serviceSource.slice(start, next === -1 ? undefined : next)
}

describe('customer import atomicity wiring', () => {
  it('routes customer import through one RPC instead of app-side dedup and insert', () => {
    const body = serviceMethodBody('importCustomers')

    expect(body).toContain("rpc('import_customers_atomic'")
    expect(body).not.toContain(".from('customers')")
    expect(body).not.toContain('.insert(')
    expect(body).not.toContain('.upsert(')
  })

  it('uses exact list counts for customer pagination', () => {
    expect(actionSource).toContain("select('id', { count: 'exact', head: true })")
    expect(actionSource).not.toContain("select('id', { count: 'estimated', head: true })")
    expect(actionSource).toContain('smsActiveCountQuery')
    expect(actionSource).toContain('smsDeactivatedCountQuery')
  })

  it('ships migration and rollback SQL for global dedup/import', () => {
    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION public.import_customers_atomic')
    expect(migrationSource).toContain('SECURITY DEFINER')
    expect(migrationSource).toContain('ON CONFLICT DO NOTHING')
    expect(migrationSource).toContain('c.mobile_e164 = v.mobile_number')
    expect(migrationSource).toContain('c.mobile_number = v.mobile_number')
    expect(migrationSource).toContain('lower(c.email) = v.email')
    expect(rollbackSource).toContain('DROP FUNCTION IF EXISTS public.import_customers_atomic')
  })

  it('keeps imported customer service contact defaults active', () => {
    expect(contactDefaultsMigrationSource).toContain('whatsapp_opt_in')
    expect(contactDefaultsMigrationSource).toContain("COALESCE((item->>'sms_opt_in')::boolean, true)")
    expect(contactDefaultsMigrationSource).toContain("COALESCE((item->>'whatsapp_opt_in')::boolean, true)")
    expect(contactDefaultsMigrationSource).toContain('marketing_email_opt_in')
    expect(contactDefaultsMigrationSource).toContain('GRANT EXECUTE ON FUNCTION public.import_customers_atomic(jsonb) TO authenticated, service_role')
    expect(contactDefaultsRollbackSource).toContain('CREATE OR REPLACE FUNCTION public.import_customers_atomic')
  })
})
