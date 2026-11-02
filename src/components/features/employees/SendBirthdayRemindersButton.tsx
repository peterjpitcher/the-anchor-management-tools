'use client'

import { useState } from 'react'
import { Button } from '@/ds'
import { toast } from '@/ds'
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

  // Says what it does: today's reminder email, for birthdays exactly a week away. It was
  // "Send Weekly Reminders", but the reminder goes daily and never covers the whole week.
  return (
    <Button 
      type="button" 
      onClick={handleSendReminders} 
      variant="primary" 
      size="sm" 
      loading={sending}
    >
      Email Reminder for Birthdays in 7 Days
    </Button>
  )
}
