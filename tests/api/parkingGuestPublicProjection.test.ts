import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PAGE_PATH = 'src/app/parking/guest/[id]/page.tsx'
const CLIENT_PATH = 'src/app/parking/guest/[id]/_components/PublicParkingClient.tsx'

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

function readSelectedColumns(source: string): string[] {
  const match = source.match(/const PUBLIC_BOOKING_COLUMNS\s*=\s*\n?\s*'([^']+)'/)
  if (!match) throw new Error('PUBLIC_BOOKING_COLUMNS allow-list not found in the guest parking page')
  return match[1].split(',').map((column) => column.trim()).filter(Boolean)
}

describe('public guest parking projection guards', () => {
  it('selects an explicit allow-list rather than every column', () => {
    const source = readRepoFile(PAGE_PATH)

    expect(source).toContain('.select(PUBLIC_BOOKING_COLUMNS)')
    expect(source).not.toContain(".select('*')")
    expect(source).not.toContain('.select("*")')

    const columns = readSelectedColumns(source)
    expect(columns.length).toBeGreaterThan(0)
    expect(columns).not.toContain('*')
    for (const column of columns) {
      expect(column).toMatch(/^[a-z0-9_]+$/)
    }
  })

  it('never selects the staff-only notes column', () => {
    const source = readRepoFile(PAGE_PATH)

    expect(readSelectedColumns(source)).not.toContain('notes')
  })

  it('only selects columns the public renderer needs', () => {
    const expected = [
      'id',
      'reference',
      'status',
      'payment_status',
      'payment_due_at',
      'start_at',
      'end_at',
      'calculated_price',
      'override_price',
      'vehicle_registration',
      'vehicle_make',
      'vehicle_model',
      'customer_first_name',
      'customer_last_name',
    ]

    expect(readSelectedColumns(readRepoFile(PAGE_PATH)).sort()).toEqual([...expected].sort())
  })

  it('does not render staff internal notes to guests', () => {
    const source = readRepoFile(CLIENT_PATH)

    expect(source).not.toContain('booking.notes')
    expect(source).not.toContain('Internal notes')
  })
})
