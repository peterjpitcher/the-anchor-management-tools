import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const actionSource = readFileSync(resolve(process.cwd(), 'src/app/actions/employeeInvite.ts'), 'utf8')
const migrationSource = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260708000024_employee_emergency_contacts_atomicity.sql'),
  'utf8'
)
const rollbackSource = readFileSync(
  resolve(process.cwd(), 'supabase/rollbacks/20260708000024_employee_emergency_contacts_atomicity.sql'),
  'utf8'
)

function emergencyContactsBranch() {
  const start = actionSource.indexOf("section === 'emergency_contacts'")
  const next = actionSource.indexOf("} else if (section === 'financial')", start)
  return actionSource.slice(start, next)
}

describe('employee onboarding emergency contact atomicity wiring', () => {
  it('uses a transaction RPC instead of delete-then-insert compensation', () => {
    const body = emergencyContactsBranch()

    expect(body).toContain("rpc('replace_employee_emergency_contacts'")
    expect(body).not.toContain(".from('employee_emergency_contacts')")
    expect(body).not.toContain('restoreContacts')
  })

  it('ships migration and rollback SQL', () => {
    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION public.replace_employee_emergency_contacts')
    expect(migrationSource).toContain('FOR UPDATE')
    expect(migrationSource).toContain('DELETE FROM public.employee_emergency_contacts')
    expect(migrationSource).toContain('INSERT INTO public.employee_emergency_contacts')
    expect(rollbackSource).toContain('DROP FUNCTION IF EXISTS public.replace_employee_emergency_contacts')
  })
})
