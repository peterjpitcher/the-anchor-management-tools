import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('table booking kitchen pacing SQL', () => {
  it('only applies the kitchen gate to food bookings', () => {
    const latestRuntime = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260728000000_highchair_outside.sql'),
      'utf8',
    )
    const livePatch = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260730000002_fix_drinks_kitchen_pacing.sql'),
      'utf8',
    )

    expect(latestRuntime).toContain(
      "IF v_purpose = 'food' AND NOT COALESCE(p_bypass_pacing, false) THEN",
    )
    expect(livePatch).toContain("v_new_guard constant text := 'IF v_purpose = ''food''")
  })
})
