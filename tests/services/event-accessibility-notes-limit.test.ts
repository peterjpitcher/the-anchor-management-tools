import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { eventSchema } from '@/services/events'
import { ACCESSIBILITY_NOTES_MAX_LENGTH } from '@/lib/events/field-limits'

// The approved access wording (website SSOT section 16, ACCESS_WORDING), as every event carries it
// since 20260911180655. The category defaults and the content generator add the assistance dogs line.
const ACCESS_WORDING =
  "Getting in from the car park is step free, and so are the bar and the dining area. The beer garden is step free straight from the car park. From inside, there's one step between the bar and the garden, and we'll put our ramp out for it if you ask. We don't have an accessible toilet. If you'd like to check what will work best for you, give us a call on 01753 682707 and we'll help."
const CATEGORY_WORDING = `${ACCESS_WORDING} Assistance dogs are always welcome.`

describe('accessibility notes limit', () => {
  it('accepts the approved access wording on an event save', () => {
    expect(ACCESS_WORDING).toHaveLength(382)
    expect(eventSchema.partial().safeParse({ accessibility_notes: ACCESS_WORDING }).success).toBe(true)
  })

  it('accepts the category default wording on an event save', () => {
    expect(CATEGORY_WORDING).toHaveLength(418)
    expect(eventSchema.partial().safeParse({ accessibility_notes: CATEGORY_WORDING }).success).toBe(true)
  })

  it('still refuses notes over the limit', () => {
    const tooLong = 'a'.repeat(ACCESSIBILITY_NOTES_MAX_LENGTH + 1)
    expect(eventSchema.partial().safeParse({ accessibility_notes: tooLong }).success).toBe(false)
  })

  it('uses the one shared limit in the category schema and the event drawer', () => {
    const root = process.cwd()
    const categories = readFileSync(join(root, 'src/app/actions/event-categories.ts'), 'utf8')
    const drawer = readFileSync(join(root, 'src/app/(authenticated)/events/_components/EventDrawer.tsx'), 'utf8')
    expect(categories).toContain('accessibility_notes: z.string().max(ACCESSIBILITY_NOTES_MAX_LENGTH)')
    expect(drawer).toContain('accessibilityNotes.trim().length > ACCESSIBILITY_NOTES_MAX_LENGTH')
  })
})
