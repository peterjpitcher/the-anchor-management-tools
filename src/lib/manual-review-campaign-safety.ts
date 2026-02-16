type PersistenceInput = {
  bookingIds: string[]
  sentAtIso: string
  reviewWindowClosesAtIso: string
  hashedToken: string
}

type CampaignProcessingError = {
  customerId: string
  bookingIds: string[]
  reason: string
}

type MetadataInput = {
  templateKey: string
  campaignKey: string
  source: string
  customerId: string
  primaryBookingId: string
  eventIds: string[]
  reviewRedirectTarget: string
}

type PersistenceResult = {
  error?: string
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  )
}

export function buildManualReviewCampaignSmsMetadata(input: MetadataInput): Record<string, string> {
  const normalizedEventIds = uniqueNonEmpty(input.eventIds).sort()

  return {
    template_key: input.templateKey,
    trigger_type: input.campaignKey,
    stage: `${input.campaignKey}:${input.customerId}`,
    source: input.source,
    campaign_customer_id: input.customerId,
    campaign_primary_booking_id: input.primaryBookingId,
    campaign_event_ids: normalizedEventIds.join(','),
    review_redirect_target: input.reviewRedirectTarget
  }
}

export async function persistManualReviewCampaignSendState(
  supabase: any,
  input: PersistenceInput
): Promise<PersistenceResult> {
  const bookingIds = uniqueNonEmpty(input.bookingIds)
  if (bookingIds.length === 0) {
    return { error: 'No booking IDs provided for review SMS persistence' }
  }

  const { data: updatedBookings, error: bookingUpdateError } = await supabase
    .from('bookings')
    .update({
      status: 'visited_waiting_for_review',
      review_sms_sent_at: input.sentAtIso,
      review_window_closes_at: input.reviewWindowClosesAtIso,
      updated_at: new Date().toISOString()
    })
    .in('id', bookingIds)
    .eq('status', 'confirmed')
    .select('id')

  if (bookingUpdateError) {
    return {
      error: `Failed to persist review SMS booking updates: ${bookingUpdateError.message || 'unknown error'}`
    }
  }

  const updatedIds = new Set(
    Array.isArray(updatedBookings)
      ? updatedBookings
          .map((row) => (row && typeof row.id === 'string' ? row.id : ''))
          .filter((id) => id.length > 0)
      : []
  )

  if (updatedIds.size !== bookingIds.length) {
    return {
      error: `Review SMS booking update affected ${updatedIds.size}/${bookingIds.length} rows`
    }
  }

  const { data: updatedToken, error: tokenUpdateError } = await supabase
    .from('guest_tokens')
    .update({
      expires_at: input.reviewWindowClosesAtIso
    })
    .eq('hashed_token', input.hashedToken)
    .select('hashed_token')
    .maybeSingle()

  if (tokenUpdateError) {
    return {
      error: `Failed to update review redirect token expiry: ${tokenUpdateError.message || 'unknown error'}`
    }
  }

  if (!updatedToken) {
    return {
      error: 'Review redirect token expiry update affected no rows'
    }
  }

  return {}
}

export async function cleanupManualReviewCampaignToken(
  supabase: any,
  hashedToken: string
): Promise<PersistenceResult> {
  const { data: deletedToken, error: tokenDeleteError } = await supabase
    .from('guest_tokens')
    .delete()
    .eq('hashed_token', hashedToken)
    .select('hashed_token')
    .maybeSingle()

  if (tokenDeleteError) {
    return {
      error: `Failed to clean up review redirect token: ${tokenDeleteError.message || 'unknown error'}`
    }
  }

  if (!deletedToken) {
    return {
      error: 'Review redirect token cleanup affected no rows'
    }
  }

  return {}
}

export function assertManualReviewCampaignCompletedWithoutErrors(
  errors: CampaignProcessingError[]
): void {
  if (errors.length === 0) {
    return
  }

  const preview = errors
    .slice(0, 3)
    .map((entry) => `${entry.customerId}:${entry.reason}`)
    .join(' | ')

  throw new Error(
    `Manual review campaign completed with ${errors.length} error(s): ${preview}`
  )
}
