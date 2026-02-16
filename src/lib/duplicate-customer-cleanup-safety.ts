type CleanupFailure = {
  customerId: string
  reason: string
}

export function assertDuplicateCleanupTargetsResolved(params: {
  requestedIds: string[]
  fetchedRows: Array<{ id: string }>
}): void {
  const requestedIds = Array.from(new Set(params.requestedIds))
  const fetchedIds = new Set(
    params.fetchedRows
      .map((row) => row.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  )

  const missingIds = requestedIds.filter((id) => !fetchedIds.has(id))
  if (missingIds.length === 0) {
    return
  }

  const preview = missingIds.slice(0, 5).join(', ')
  throw new Error(
    `Duplicate cleanup target check failed: found ${requestedIds.length - missingIds.length}/${requestedIds.length} requested customer rows; missing IDs: ${preview}`
  )
}

export function assertDuplicateCleanupCompletedWithoutFailures(
  failures: CleanupFailure[]
): void {
  if (failures.length === 0) {
    return
  }

  const preview = failures
    .slice(0, 3)
    .map((failure) => `${failure.customerId}:${failure.reason}`)
    .join(' | ')

  throw new Error(
    `delete-approved-duplicates completed with ${failures.length} failure(s): ${preview}`
  )
}
