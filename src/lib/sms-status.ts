/**
 * SMS Status Management
 * Handles mapping between Twilio statuses and our application statuses
 * Includes progression guard to prevent status regression
 */

// Twilio's possible message statuses
export type TwilioStatus =
  | 'accepted'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'undelivered'
  | 'failed'
  | 'canceled'
  | 'scheduled'
  | 'receiving'
  | 'received'
  | 'read';

// Our simplified application statuses
export type AppStatus = 
  | 'queued'
  | 'sent' 
  | 'delivered'
  | 'failed'
  | 'received'
  | 'delivery_unknown';

// Map Twilio status to our simplified status
export const STATUS_MAP: Record<TwilioStatus, AppStatus> = {
  accepted: 'queued',
  queued: 'queued',
  sending: 'sent',
  sent: 'sent',
  delivered: 'delivered',
  undelivered: 'failed',
  failed: 'failed',
  canceled: 'failed',
  scheduled: 'queued',
  receiving: 'received',
  received: 'received',
  read: 'received',
};

// Status progression order (higher number = more final)
const STATUS_ORDER: Record<string, number> = {
  // Outbound progression
  accepted: 0,
  queued: 1,
  scheduled: 1,
  sending: 2,
  sent: 3,
  delivered: 4,
  
  // Terminal states (same level, no progression between them)
  undelivered: 4,
  failed: 4,
  canceled: 4,
  
  // Inbound states
  receiving: 4,
  received: 5,
  read: 6,
};

/**
 * Map Twilio status to our application status
 */
export function mapTwilioStatus(twilioStatus: string): AppStatus {
  const status = twilioStatus.toLowerCase() as TwilioStatus;
  return STATUS_MAP[status] || 'queued';
}

/**
 * Check if a status transition is valid (prevents regression)
 * @param currentStatus - Current status in database
 * @param newStatus - New status from webhook
 * @returns true if the transition is allowed
 */
export function isStatusUpgrade(currentStatus?: string, newStatus?: string): boolean {
  if (!currentStatus || !newStatus) return true;
  
  const currentOrder = STATUS_ORDER[currentStatus.toLowerCase()] ?? -1;
  const newOrder = STATUS_ORDER[newStatus.toLowerCase()] ?? -1;
  
  return newOrder >= currentOrder;
}

/**
 * Determine if a message should be considered "delivery unknown"
 * Messages stuck in 'sent' for over 6 hours without delivery confirmation
 */
export function shouldMarkDeliveryUnknown(status: string, sentAt: Date | string): boolean {
  if (status !== 'sent') return false;
  
  const sentTime = typeof sentAt === 'string' ? new Date(sentAt) : sentAt;
  const hoursSinceSent = (Date.now() - sentTime.getTime()) / (1000 * 60 * 60);
  
  return hoursSinceSent > 6;
}

/**
 * Format error code to user-friendly message
 */
export function formatErrorMessage(errorCode?: string | number | null): string {
  if (!errorCode) return 'Message delivery failed';
  
  const code = errorCode.toString();
  
  // Common Twilio error codes
  const ERROR_MESSAGES: Record<string, string> = {
    '21211': 'Invalid phone number format',
    '21408': 'Permission to send to this region denied',
    '21610': 'Recipient has opted out of messages',
    '21611': 'SMS queued but cannot be sent',
    '21614': 'Invalid mobile number',
    '21617': 'Message body missing or invalid',
    '30003': 'Unreachable - device may be off or out of coverage',
    '30004': 'Message blocked by carrier',
    '30005': 'Unknown destination',
    '30006': 'Landline or unreachable carrier',
    '30007': 'Carrier violation - message filtered',
    '30008': 'Unknown error from carrier',
    '30034': 'Carrier temporarily unavailable',
  };
  
  return ERROR_MESSAGES[code] || `Delivery failed (Error ${code})`;
}

/**
 * Check if a message is stuck and needs reconciliation
 */
export function isMessageStuck(status: string, createdAt: Date | string, direction: string = 'outbound'): boolean {
  // Only check outbound messages
  if (direction !== 'outbound' && direction !== 'outbound-api') return false;
  
  // Only queued and sent statuses can be "stuck"
  if (status !== 'queued' && status !== 'sent') return false;
  
  const createdTime = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  const hoursSinceCreated = (Date.now() - createdTime.getTime()) / (1000 * 60 * 60);
  
  // Consider stuck if:
  // - Queued for more than 1 hour
  // - Sent for more than 2 hours
  if (status === 'queued' && hoursSinceCreated > 1) return true;
  if (status === 'sent' && hoursSinceCreated > 2) return true;
  
  return false;
}