export type SendSmsMetadataInput = {
  bookingId?: string
  metadata?: Record<string, unknown>
  templateKey?: string
  triggerType?: string
}

export function buildSendSmsMetadata(
  params: SendSmsMetadataInput
): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {
    ...(params.metadata || {})
  }

  if (params.bookingId && metadata.booking_id === undefined) {
    metadata.booking_id = params.bookingId
  }

  if (params.templateKey && metadata.template_key === undefined) {
    metadata.template_key = params.templateKey
  }

  if (params.triggerType && metadata.trigger_type === undefined) {
    metadata.trigger_type = params.triggerType
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined
}
