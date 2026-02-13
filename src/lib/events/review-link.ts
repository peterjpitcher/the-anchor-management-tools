import type { SupabaseClient } from '@supabase/supabase-js'

const FALLBACK_REVIEW_URL = 'https://vip-club.uk/jls0mu'

function pickStringValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const candidateKeys = ['url', 'review_url', 'google_review_link', 'value']
    for (const key of candidateKeys) {
      const candidate = pickStringValue(record[key])
      if (candidate) {
        return candidate
      }
    }
  }

  return null
}

export async function getGoogleReviewLink(
  supabase: SupabaseClient<any, 'public', any>
): Promise<string> {
  const { data } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'google_review_link')
    .maybeSingle()

  const configured = pickStringValue(data?.value)
  return configured || FALLBACK_REVIEW_URL
}
