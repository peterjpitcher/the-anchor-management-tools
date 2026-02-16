type ScriptDbError = { message?: string; code?: string } | null

export function assertTwilioLogBackfillLookupSafe(params: {
  phone: string
  error: ScriptDbError
}): void {
  if (!params.error) {
    return
  }

  throw new Error(
    `Failed to look up customer by phone ${params.phone}: ${params.error.message || 'unknown database error'}`
  )
}

export function isTwilioLogBackfillDuplicateKeyError(error: ScriptDbError): boolean {
  return error?.code === '23505'
}

export function assertTwilioLogBackfillBatchInsertComplete(params: {
  expectedRows: number
  insertedRows: Array<{ id?: string }> | null
}): { insertedCount: number } {
  const insertedCount = Array.isArray(params.insertedRows) ? params.insertedRows.length : 0
  if (insertedCount !== params.expectedRows) {
    throw new Error(
      `Twilio log backfill batch insert affected unexpected row count (expected ${params.expectedRows}, got ${insertedCount})`
    )
  }

  return { insertedCount }
}

export function assertTwilioLogBackfillCompletedWithoutUnresolvedRows(params: {
  unresolvedRows: Array<{ sid: string; reason: string }>
}): void {
  if (params.unresolvedRows.length === 0) {
    return
  }

  const preview = params.unresolvedRows
    .slice(0, 5)
    .map((row) => `${row.sid}:${row.reason}`)
    .join(' | ')

  throw new Error(
    `Twilio log backfill completed with ${params.unresolvedRows.length} unresolved row(s): ${preview}`
  )
}
