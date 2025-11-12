export function parsePaymentTermsValue(value: FormDataEntryValue | null): number | undefined {
  if (value == null) return undefined
  const stringValue = String(value).trim()
  if (!stringValue) return undefined

  const parsed = Number.parseInt(stringValue, 10)
  if (Number.isNaN(parsed) || parsed < 0) {
    return undefined
  }

  return parsed
}
