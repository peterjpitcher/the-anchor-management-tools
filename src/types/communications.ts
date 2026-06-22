export type CommunicationChannel = 'sms' | 'whatsapp' | 'email' | 'feedback'
export type NotificationChannel = 'email' | 'whatsapp' | 'sms'
export type CommunicationDirection = 'inbound' | 'outbound'

export type CommunicationAttachment = {
  id?: string
  filename?: string
  name?: string
  content_type?: string
  contentType?: string
  size?: number
  storage_path?: string
  storagePath?: string
  download_url?: string
  expires_at?: string
}

export type CustomerCommunication = {
  id: string
  customer_id: string
  channel: CommunicationChannel
  direction: CommunicationDirection
  status: string
  subject: string | null
  body_text: string | null
  body_html: string | null
  from_address: string | null
  to_address: string | null
  created_at: string
  sent_at: string | null
  delivered_at: string | null
  failed_at: string | null
  read_at: string | null
  opened_at: string | null
  clicked_at: string | null
  bounced_at: string | null
  staff_read_at: string | null
  replied_at: string | null
  delivery_history: unknown[]
  has_attachments: boolean
  attachments: CommunicationAttachment[] | null
  engagement: Record<string, unknown>
  context: {
    event_id?: string | null
    event_booking_id?: string | null
    table_booking_id?: string | null
    private_booking_id?: string | null
    parking_booking_id?: string | null
    invoice_id?: string | null
    quote_id?: string | null
  }
  twilio_message_sid: string | null
  resend_message_id: string | null
  cost: number | null
  segments: number | null
  updated_at: string | null
}

export type EmailMessage = {
  id: string
  customer_id: string | null
  direction: CommunicationDirection
  to_address: string
  from_address: string | null
  subject: string | null
  body_text: string | null
  body_html: string | null
  status: string
  resend_message_id: string | null
  received_at: string | null
  staff_read_at: string | null
  replied_at: string | null
  has_attachments: boolean
  attachments: CommunicationAttachment[] | null
  created_at: string
  updated_at: string
}

export type UnmatchedCommunication = {
  id: string
  channel: Exclude<CommunicationChannel, 'feedback'>
  direction: 'inbound'
  twilio_message_sid: string | null
  resend_message_id: string | null
  from_address: string | null
  to_address: string | null
  subject: string | null
  body_text: string | null
  body_html: string | null
  attachments: CommunicationAttachment[] | null
  received_at: string
  candidate_customer_ids: string[]
  status: 'unmatched' | 'linked' | 'ignored' | 'deleted'
  linked_customer_id: string | null
  linked_message_id: string | null
  linked_email_message_id: string | null
}
