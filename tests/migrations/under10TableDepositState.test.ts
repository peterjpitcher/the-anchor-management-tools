import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationPath = join(migrationsDir, '20260627000000_fix_under10_table_deposit_state.sql')
const migrationSql = readFileSync(migrationPath, 'utf8')

describe('under-10 table deposit state migration', () => {
  it('runs after the deposit amount lock migration', () => {
    const migrations = readdirSync(migrationsDir).sort()

    expect(migrations.indexOf('20260509000014_add_deposit_amount_locked.sql')).toBeGreaterThanOrEqual(0)
    expect(migrations.indexOf('20260627000000_fix_under10_table_deposit_state.sql')).toBeGreaterThan(
      migrations.indexOf('20260509000014_add_deposit_amount_locked.sql'),
    )
  })

  it('marks stale pending table-deposit payments as failed with audit metadata', () => {
    expect(migrationSql).toContain('CREATE OR REPLACE FUNCTION public.neutralise_under10_table_deposit_state_v01')
    expect(migrationSql).toContain("charge_type = 'table_deposit'")
    expect(migrationSql).toContain("status = 'failed'")
    expect(migrationSql).toContain("'cancelled_reason'")
    expect(migrationSql).toContain("'deposit_required_only_for_10_plus_covers'")
    expect(migrationSql).toContain("'under10_table_deposit_state_fix'")
  })

  it('clears future under-10 confirmed booking deposit fields without touching successful deposits', () => {
    expect(migrationSql).toContain("tb.status = 'confirmed'::public.table_booking_status")
    expect(migrationSql).toContain('COALESCE(tb.committed_party_size, tb.party_size, 0) < 10')
    expect(migrationSql).toContain('tb.start_datetime')
    expect(migrationSql).toContain("p.status = 'succeeded'")
    expect(migrationSql).toContain('payment_status = NULL')
    expect(migrationSql).toContain('payment_method = NULL')
    expect(migrationSql).toContain('deposit_amount = NULL')
    expect(migrationSql).toContain('deposit_amount_locked = NULL')
    expect(migrationSql).toContain('paypal_deposit_order_id = NULL')
  })

  it('patches event-linked table reservations to neutralise confirmed under-10 deposit artifacts', () => {
    expect(migrationSql).toContain('CREATE OR REPLACE FUNCTION public.create_event_table_reservation_v05')
    expect(migrationSql).toContain("p_party_size < 10")
    expect(migrationSql).toContain("'event_table_reservation_confirmed_under10_existing'")
    expect(migrationSql).toContain("'event_table_reservation_confirmed_under10_new'")
    expect(migrationSql).toContain('PERFORM public.neutralise_under10_table_deposit_state_v01')
  })
})
