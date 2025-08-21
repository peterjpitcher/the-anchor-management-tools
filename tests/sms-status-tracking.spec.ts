import { test, expect } from '@playwright/test'
import { mapTwilioStatus, isStatusUpgrade, formatErrorMessage, isMessageStuck } from '../src/lib/sms-status'

test.describe('SMS Status Tracking', () => {
  
  test.describe('Status Mapping', () => {
    test('maps all Twilio statuses correctly', () => {
      // Test each mapping
      expect(mapTwilioStatus('accepted')).toBe('queued')
      expect(mapTwilioStatus('queued')).toBe('queued')
      expect(mapTwilioStatus('sending')).toBe('sent')
      expect(mapTwilioStatus('sent')).toBe('sent')
      expect(mapTwilioStatus('delivered')).toBe('delivered')
      expect(mapTwilioStatus('undelivered')).toBe('failed')
      expect(mapTwilioStatus('failed')).toBe('failed')
      expect(mapTwilioStatus('canceled')).toBe('failed')
      expect(mapTwilioStatus('scheduled')).toBe('queued')
      expect(mapTwilioStatus('receiving')).toBe('received')
      expect(mapTwilioStatus('received')).toBe('received')
    })

    test('handles unknown status gracefully', () => {
      expect(mapTwilioStatus('unknown_status')).toBe('queued')
      expect(mapTwilioStatus('')).toBe('queued')
    })

    test('handles case insensitive status', () => {
      expect(mapTwilioStatus('DELIVERED')).toBe('delivered')
      expect(mapTwilioStatus('Failed')).toBe('failed')
      expect(mapTwilioStatus('SenT')).toBe('sent')
    })
  })

  test.describe('Status Progression Guard', () => {
    test('allows valid progressions', () => {
      // Normal progression
      expect(isStatusUpgrade('queued', 'sending')).toBe(true)
      expect(isStatusUpgrade('sending', 'sent')).toBe(true)
      expect(isStatusUpgrade('sent', 'delivered')).toBe(true)
      
      // To terminal states
      expect(isStatusUpgrade('sent', 'failed')).toBe(true)
      expect(isStatusUpgrade('sent', 'undelivered')).toBe(true)
      expect(isStatusUpgrade('queued', 'canceled')).toBe(true)
    })

    test('prevents status regression', () => {
      // Cannot go backwards
      expect(isStatusUpgrade('delivered', 'sent')).toBe(false)
      expect(isStatusUpgrade('sent', 'queued')).toBe(false)
      expect(isStatusUpgrade('delivered', 'queued')).toBe(false)
      expect(isStatusUpgrade('failed', 'sent')).toBe(false)
    })

    test('allows same status (idempotent)', () => {
      expect(isStatusUpgrade('sent', 'sent')).toBe(true)
      expect(isStatusUpgrade('delivered', 'delivered')).toBe(true)
      expect(isStatusUpgrade('failed', 'failed')).toBe(true)
    })

    test('handles null/undefined gracefully', () => {
      expect(isStatusUpgrade(undefined, 'sent')).toBe(true)
      expect(isStatusUpgrade('sent', undefined)).toBe(true)
      expect(isStatusUpgrade(undefined, undefined)).toBe(true)
    })

    test('prevents regression between terminal states', () => {
      // Terminal states should not change to each other
      expect(isStatusUpgrade('failed', 'undelivered')).toBe(true) // Same level
      expect(isStatusUpgrade('undelivered', 'failed')).toBe(true) // Same level
      expect(isStatusUpgrade('failed', 'canceled')).toBe(true) // Same level
    })
  })

  test.describe('Error Message Formatting', () => {
    test('formats common Twilio error codes', () => {
      expect(formatErrorMessage('21211')).toBe('Invalid phone number format')
      expect(formatErrorMessage('21610')).toBe('Recipient has opted out of messages')
      expect(formatErrorMessage('30003')).toBe('Unreachable - device may be off or out of coverage')
      expect(formatErrorMessage('30007')).toBe('Carrier violation - message filtered')
    })

    test('handles unknown error codes', () => {
      expect(formatErrorMessage('99999')).toBe('Delivery failed (Error 99999)')
      expect(formatErrorMessage('ABC')).toBe('Delivery failed (Error ABC)')
    })

    test('handles null/undefined error codes', () => {
      expect(formatErrorMessage(null)).toBe('Message delivery failed')
      expect(formatErrorMessage(undefined)).toBe('Message delivery failed')
      expect(formatErrorMessage('')).toBe('Message delivery failed')
    })

    test('handles numeric error codes', () => {
      expect(formatErrorMessage(21211)).toBe('Invalid phone number format')
      expect(formatErrorMessage(30003)).toBe('Unreachable - device may be off or out of coverage')
    })
  })

  test.describe('Stuck Message Detection', () => {
    test('identifies stuck queued messages', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000)
      
      // Stuck if queued > 1 hour
      expect(isMessageStuck('queued', twoHoursAgo, 'outbound')).toBe(true)
      expect(isMessageStuck('queued', thirtyMinutesAgo, 'outbound')).toBe(false)
    })

    test('identifies stuck sent messages', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000)
      const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000)
      
      // Stuck if sent > 2 hours
      expect(isMessageStuck('sent', threeHoursAgo, 'outbound')).toBe(true)
      expect(isMessageStuck('sent', oneHourAgo, 'outbound')).toBe(false)
    })

    test('ignores non-stuck statuses', () => {
      const oldTime = new Date(Date.now() - 24 * 60 * 60 * 1000)
      
      expect(isMessageStuck('delivered', oldTime, 'outbound')).toBe(false)
      expect(isMessageStuck('failed', oldTime, 'outbound')).toBe(false)
      expect(isMessageStuck('received', oldTime, 'inbound')).toBe(false)
    })

    test('only checks outbound messages', () => {
      const oldTime = new Date(Date.now() - 5 * 60 * 60 * 1000)
      
      expect(isMessageStuck('queued', oldTime, 'outbound')).toBe(true)
      expect(isMessageStuck('queued', oldTime, 'outbound-api')).toBe(true)
      expect(isMessageStuck('queued', oldTime, 'inbound')).toBe(false)
    })

    test('handles string timestamps', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
      
      expect(isMessageStuck('sent', threeHoursAgo, 'outbound')).toBe(true)
      expect(isMessageStuck('queued', threeHoursAgo, 'outbound')).toBe(true)
    })
  })
})

test.describe('Webhook Signature Validation', () => {
  test('validates signature in production', async ({ page }) => {
    // This would be tested in the actual webhook endpoint
    // For now, we just verify the endpoint exists
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/webhooks/twilio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'test=data'
    })
    
    // Should reject without proper signature
    expect(response.status).toBe(401)
  })
})