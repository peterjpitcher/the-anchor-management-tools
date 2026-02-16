export type PhoneCleanupCandidate = {
  id: string
  mobileNumber: string
  firstName: string
  lastName: string
}

export function extractPhoneCleanupCandidates(
  rows: Array<{
    id: unknown
    mobile_number: unknown
    first_name?: unknown
    last_name?: unknown
  }>
): PhoneCleanupCandidate[] {
  const invalidRows: string[] = []
  const candidates: PhoneCleanupCandidate[] = []

  rows.forEach((row, index) => {
    const rowRef = `row#${index + 1}`
    if (typeof row.id !== 'string' || row.id.trim().length === 0) {
      invalidRows.push(`${rowRef}:invalid-id`)
      return
    }

    if (
      typeof row.mobile_number !== 'string'
      || row.mobile_number.trim().length === 0
    ) {
      invalidRows.push(`${rowRef}:invalid-mobile-number`)
      return
    }

    candidates.push({
      id: row.id.trim(),
      mobileNumber: row.mobile_number,
      firstName:
        typeof row.first_name === 'string' && row.first_name.trim().length > 0
          ? row.first_name.trim()
          : 'Unknown',
      lastName:
        typeof row.last_name === 'string' && row.last_name.trim().length > 0
          ? row.last_name.trim()
          : ''
    })
  })

  if (invalidRows.length > 0) {
    throw new Error(
      `Cannot safely process phone-cleanup rows due to invalid data: ${invalidRows.join(', ')}`
    )
  }

  return candidates
}

export function assertPhoneCleanupCompletedWithoutFailures(failures: string[]): void {
  if (failures.length === 0) {
    return
  }

  throw new Error(
    `Phone cleanup finished with ${failures.length} failure(s): ${failures.join(' | ')}`
  )
}
