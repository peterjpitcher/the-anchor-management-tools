import type { SupabaseClient } from '@supabase/supabase-js'

// Public feedback page short link. It offers every guest the same two choices,
// leave a Google review or send private feedback, without asking how the visit
// went first. Every review ask points here, never straight at Google.
export const FEEDBACK_FUNNEL_URL = 'https://l.the-anchor.pub/feedback'

const FALLBACK_REVIEW_URL = FEEDBACK_FUNNEL_URL

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

// Single source of truth for the review-ask destination used in SMS and
// redirects. Despite the legacy setting name, `system_settings.google_review_link`
// currently points at the feedback page above. Do not "correct" it to a Google
// URL: every review ask must go through that page, which offers private feedback
// alongside Google.
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
