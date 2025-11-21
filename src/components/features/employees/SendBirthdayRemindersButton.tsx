'use client'

import { useState } from 'react'
import { Button } from '@/components/ui-v2/forms/Button'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { sendBirthdayReminders } from '@/app/actions/employee-birthdays'

export default function SendBirthdayRemindersButton() {
  const [sending, setSending] = useState(false)

  const handleSendReminders = async () => {
    setSending(true)
    try {
      const result = await sendBirthdayReminders()
      if (result.error) {
        toast.error(result.error)
      } else if ('message' in result) {
        toast.success(result.message || 'Birthday reminders sent')
      } else {
        toast.success('Birthday reminders sent')
      }
    } catch {
      toast.error('Failed to send reminders')
    } finally {
      setSending(false)
    }
  }

  return (
    <Button 
      type="button" 
      onClick={handleSendReminders} 
      variant="primary" 
      size="sm" 
      loading={sending}
    >
      {sending ? 'Sending…' : 'Send Weekly Reminders'}
    </Button>
  )
}
