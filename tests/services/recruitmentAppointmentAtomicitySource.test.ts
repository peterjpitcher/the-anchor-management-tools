import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const serviceSource = readFileSync(resolve(process.cwd(), 'src/services/recruitment.ts'), 'utf8')
const migrationSource = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260708000019_recruitment_appointment_atomicity.sql'),
  'utf8'
)
const rollbackSource = readFileSync(
  resolve(process.cwd(), 'supabase/rollbacks/20260708000019_recruitment_appointment_atomicity.sql'),
  'utf8'
)

function functionBody(name: string) {
  const start = serviceSource.indexOf(`export async function ${name}`)
  const next = serviceSource.indexOf('\nexport async function ', start + 1)
  return serviceSource.slice(start, next === -1 ? undefined : next)
}

describe('recruitment appointment atomicity wiring', () => {
  it('uses RPCs for claim and reschedule flows', () => {
    const claimBody = functionBody('claimRecruitmentAppointmentSlot')
    expect(claimBody).toContain("rpc('recruitment_claim_appointment_slot'")
    expect(claimBody).not.toContain("update({ booking_token_used_at")

    expect(functionBody('rescheduleRecruitmentAppointmentByStaff')).toContain("rpc('recruitment_reschedule_appointment'")
    expect(functionBody('rescheduleRecruitmentAppointment')).toContain("rpc('recruitment_reschedule_appointment'")
  })

  it('ships migration and rollback SQL for the RPC changes', () => {
    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION public.recruitment_claim_appointment_slot')
    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION public.recruitment_reschedule_appointment')
    expect(rollbackSource).toContain('DROP FUNCTION IF EXISTS public.recruitment_reschedule_appointment')
    expect(rollbackSource).toContain('CREATE OR REPLACE FUNCTION public.recruitment_claim_appointment_slot')
  })
})
