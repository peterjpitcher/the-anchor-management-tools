type PendingInviteReminderRow = {
  id: unknown
  booking_id: unknown
}

export type InviteReminderDeletePlan = {
  bookingIds: string[]
  expectedDeletesByBooking: Record<string, number>
}

export function buildInviteReminderDeletePlan(
  rows: PendingInviteReminderRow[]
): InviteReminderDeletePlan {
  const invalidRowRefs: string[] = []
  const duplicateReminderIds: string[] = []
  const reminderIds = new Set<string>()
  const bookingIds: string[] = []
  const bookingIdSet = new Set<string>()
  const expectedDeletesByBooking: Record<string, number> = {}

  rows.forEach((row, index) => {
    const rowRef = `row#${index + 1}`
    if (typeof row.id !== 'string' || row.id.trim().length === 0) {
      invalidRowRefs.push(`${rowRef}:invalid-id`)
      return
    }
    if (typeof row.booking_id !== 'string' || row.booking_id.trim().length === 0) {
      invalidRowRefs.push(`${rowRef}:invalid-booking-id`)
      return
    }

    const reminderId = row.id.trim()
    const bookingId = row.booking_id.trim()

    if (reminderIds.has(reminderId)) {
      duplicateReminderIds.push(reminderId)
      return
    }
    reminderIds.add(reminderId)

    expectedDeletesByBooking[bookingId] = (expectedDeletesByBooking[bookingId] || 0) + 1
    if (!bookingIdSet.has(bookingId)) {
      bookingIdSet.add(bookingId)
      bookingIds.push(bookingId)
    }
  })

  if (invalidRowRefs.length > 0) {
    throw new Error(
      `Cannot safely build invite-reminder migration plan because pending rows include invalid data: ${invalidRowRefs.join(', ')}`
    )
  }

  if (duplicateReminderIds.length > 0) {
    throw new Error(
      `Cannot safely build invite-reminder migration plan because pending rows contain duplicate reminder ids: ${Array.from(new Set(duplicateReminderIds)).join(', ')}`
    )
  }

  return {
    bookingIds,
    expectedDeletesByBooking
  }
}

export function assertInviteReminderMigrationCompletedWithoutFailures(
  failures: string[]
): void {
  if (failures.length === 0) {
    return
  }

  throw new Error(
    `Invite-reminder migration finished with ${failures.length} failure(s): ${failures.join(' | ')}`
  )
}
