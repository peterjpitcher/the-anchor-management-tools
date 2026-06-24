export function parseBulkMessageCustomerIds(value: string | string[] | undefined): string[] {
  const rawValues = Array.isArray(value) ? value : value ? [value] : []
  const ids = rawValues
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  return Array.from(new Set(ids))
}
