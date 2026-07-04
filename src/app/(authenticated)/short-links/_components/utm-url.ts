export interface UtmFields {
  source: string
  medium: string
  campaign: string
}

/**
 * Applies the UTM form fields to a destination URL.
 *
 * When the UTM section is hidden the URL is returned untouched. When it is
 * shown, each utm_* param is SET from a non-empty field or DELETED when the
 * field is blank — so clearing a field on edit genuinely removes the param.
 */
export function applyUtmParams(destinationUrl: string, utm: UtmFields, showUtm: boolean): string {
  if (!showUtm) return destinationUrl

  const parsed = new URL(destinationUrl)
  const params: Array<[string, string]> = [
    ['utm_source', utm.source],
    ['utm_medium', utm.medium],
    ['utm_campaign', utm.campaign],
  ]

  for (const [key, value] of params) {
    if (value.trim()) parsed.searchParams.set(key, value.trim())
    else parsed.searchParams.delete(key)
  }

  return parsed.toString()
}
