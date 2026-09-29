import { z } from 'zod'
import { houseStyleErrors } from '@/lib/copy/house-style'

export type PromotionChannel = 'facebook_event' | 'google_business_profile_event'

type PromotionContent = { name: string; description: string } | { title: string; description: string }

const text = z.string().trim().min(1, 'must not be empty')
const schemas = {
  facebook_event: z.object({ name: text.max(70), description: text.max(3000) }).strict(),
  google_business_profile_event: z.object({ title: text.max(58), description: text.max(1500) }).strict(),
}

// Count complete emoji sequences, including joined families, flags and skin tones.
const emojiPattern = /(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})*(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})*)*)/gu
const urlPattern = /(?:\b[a-z][a-z\d+.-]*:\/\/|\bwww\.|\b(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,63}\b)/i
const markdownPattern = /(?:^\s{0,3}(?:#{1,6}\s|>\s|[-*+]\s|\d+[.)]\s)|\*{1,2}[^*\n]+\*{1,2}|_{1,2}[^_\n]+_{1,2}|~~[^~\n]+~~|`|!?\[[^\]]+\]\([^)]*\))/m

/** Editorial checks only: event facts are checked separately against the supplied source. */
export function validatePromotionCopy(
  channel: PromotionChannel,
  value: unknown,
): { content: PromotionContent | null; issues: string[] } {
  const result = schemas[channel].safeParse(value)
  if (!result.success) {
    return {
      content: null,
      issues: result.error.issues.map((issue) => `${issue.path.join('.') || 'Copy'}: ${issue.message}`),
    }
  }

  const content = result.data
  const title = 'name' in content ? content.name : content.title
  const combined = `${title}\n${content.description}`
  const issues: string[] = []
  if (/<\/?[a-z][^>]*>|<!--|<!doctype/i.test(combined)) issues.push('Remove HTML and use plain text.')
  if (markdownPattern.test(combined)) issues.push('Remove markdown formatting and use plain text paragraphs.')
  if (urlPattern.test(combined)) issues.push('Remove URLs and domains; use the separate CTA link field.')
  if (/\u2014/.test(combined)) issues.push('Replace the long dash with a comma, colon or full stop.')

  const titleEmojis = title.match(emojiPattern)?.length ?? 0
  const descriptionEmojis = content.description.match(emojiPattern)?.length ?? 0
  if (channel === 'google_business_profile_event') {
    if (titleEmojis + descriptionEmojis > 0) issues.push('Remove emojis from Google Business Profile copy.')
    if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}|(^|\s)@[\w.]+/i.test(combined)) {
      issues.push('Remove email addresses and social handles from Google Business Profile copy.')
    }
    // ISO dates are event details, not telephone numbers.
    const withoutDates = combined.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
    if ((withoutDates.match(/\+?\d[\d ()-]{7,}\d/g) ?? []).some((candidate) => candidate.replace(/\D/g, '').length >= 9)) {
      issues.push('Remove telephone numbers from Google Business Profile copy; use the profile contact button.')
    }
  } else {
    if (titleEmojis > 0) issues.push('Remove emojis from the Facebook event name.')
    if (descriptionEmojis > 1) issues.push('Use at most one emoji in the Facebook event description.')
  }

  for (const finding of houseStyleErrors(combined)) issues.push(finding.message)
  return { content: issues.length === 0 ? content : null, issues: [...new Set(issues)] }
}
