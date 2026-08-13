/** How a failed send attempt should be treated by the queue. */
export type FailureClass = 'retryable' | 'terminal'

/**
 * Decide whether a failed provider call is worth another attempt.
 *
 * Biased towards retryable, and that bias is deliberate. A wrongly terminal classification
 * silently drops a recipient from a campaign for good; a wrongly retryable one costs at most
 * two more attempts before `release_marketing_claim` gives up at `max_attempts` anyway. So
 * anything not recognisably a permanent problem with this recipient or this payload gets
 * another go.
 *
 * Retryable patterns are tested first so that a transient message can never be overruled by
 * a terminal-looking word elsewhere in the same string.
 */
const RETRYABLE_PATTERNS: RegExp[] = [
  /rate.?limit/i,
  /too many requests/i,
  /\b(?:429|500|502|503|504)\b/,
  /internal server error/i,
  /bad gateway/i,
  /service unavailable/i,
  /temporarily unavailable/i,
  /gateway time-?out/i,
  /time(?:d)?[ _-]?out/i,
  /timeout/i,
  /socket hang up/i,
  /fetch failed/i,
  /network (?:error|failure)/i,
  /connection (?:reset|refused|closed|error)/i,
  /\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ESOCKETTIMEDOUT|EPIPE)\b/i,
  /could not be checked/i,
  /try again/i,
]

const TERMINAL_PATTERNS: RegExp[] = [
  /suppress/i,
  /unsubscrib/i,
  /do[ _-]?not[ _-]?contact/i,
  /validation[ _-]?(?:error|failed)/i,
  /invalid[ _-]?(?:to|from|reply|recipient|e-?mail|address|parameter|field|body|attachment)/i,
  /missing[ _-]?required[ _-]?field/i,
  /not[ _-]?a[ _-]?valid[ _-]?e-?mail/i,
  /must be a valid e-?mail/i,
  /recipient[^.]*(?:rejected|blocked|blacklisted|does not exist)/i,
  /domain[ _-]?(?:is[ _-]?)?not[ _-]?verified/i,
  /\b(?:400|422)\b/,
]

export function classifySendFailure(message: string): FailureClass {
  const text = message ?? ''
  if (RETRYABLE_PATTERNS.some((pattern) => pattern.test(text))) return 'retryable'
  if (TERMINAL_PATTERNS.some((pattern) => pattern.test(text))) return 'terminal'
  return 'retryable'
}
